// Función de servidor «coach» (opcional, desactivada por defecto).
//
// Solo se usa si se despliega en Supabase y se configura el secreto
// ANTHROPIC_API_KEY (y la variable VITE_COACH_AI_ENABLED=true en la web).
// La clave del proveedor nunca llega al navegador. El contexto se construye
// con datos estructurados del propio usuario (leídos con su sesión y RLS);
// las fotografías NO forman parte del contexto.
//
// Despliegue:  workflow manual «coach-deploy» (o: supabase functions deploy coach
//              y supabase secrets set ANTHROPIC_API_KEY=...  [COACH_MODEL=...]).
// Variables opcionales: COACH_MODEL (por defecto claude-haiku-5-5),
// COACH_DAILY_LIMIT (mensajes de usuario al día, por defecto 40).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const MODEL = Deno.env.get("COACH_MODEL") ?? "claude-haiku-5-5";
const DAILY_LIMIT = Number(Deno.env.get("COACH_DAILY_LIMIT") ?? "40");
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `Eres el asistente de entrenamiento de la app personal «Adolfo Training». Respondes en español, de forma breve y concreta.
Reglas:
- Usa solo los datos proporcionados. Si falta un dato, dilo («Sin datos»); no lo inventes (ni edad, ni FC máxima, ni peso objetivo, ni antecedentes).
- No diagnostiques ni des consejo médico. HRV, aptitud y fatiga son estimaciones, no medidas de recuperación completa.
- No atribuyas causas a cambios de peso o físico por simples coincidencias temporales.
- e-MTB y MTB son deportes distintos; en e-MTB la velocidad y la distancia dependen de la asistencia.
- Si propones sesiones, devuélvelas en el campo "proposals" con: date (YYYY-MM-DD), category (hiit|emtb|mtb|run|otro|descanso), title, objective, warmup, main_block, cooldown, duration_min, intensity (suave|moderada|alta), location (casa|exterior|gimnasio|otro), rationale.
- Las propuestas nunca se aplican solas: el usuario las revisa.
- Tienes la conversación previa: no repitas lo ya dicho y responde a lo último que pregunta el usuario.
- Apóyate en los resúmenes semanales (carga, horas, sesiones) para hablar de tendencias; cita cifras concretas de los datos.
Responde SOLO con JSON: {"content": "texto para el usuario", "proposals": [ ... ]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return Response.json({ content: "El asistente con IA no está configurado en el servidor." }, { headers: cors });

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: user } = await sb.auth.getUser();
  if (!user?.user) return new Response("No autorizado", { status: 401, headers: cors });

  const { message, today } = await req.json();
  const q = String(message ?? "").slice(0, 2000);
  const day = String(today ?? new Date().toISOString().slice(0, 10));

  // Tope diario de mensajes (el mensaje actual ya está guardado por la web).
  const dayStart = new Date(`${day}T00:00:00`).toISOString();
  const { count } = await sb.from("coach_messages").select("id", { count: "exact", head: true }).eq("role", "user").gte("created_at", dayStart);
  if ((count ?? 0) > DAILY_LIMIT) {
    return Response.json({ content: `Has alcanzado el límite de ${DAILY_LIMIT} mensajes al día con el asistente. Mañana podrás seguir; mientras tanto, las acciones rápidas funcionan sin límite.` }, { headers: cors });
  }

  const since = new Date(Date.now() - 42 * 86400000).toISOString().slice(0, 10);
  const [profile, acts, well, checks, plan, meas, hist] = await Promise.all([
    sb.from("profiles").select("goals,available_days,session_minutes_default,sport_priority,equipment,limitations,preferences,hr_max_bpm,weight_goal_kg").maybeSingle(),
    sb.from("activities").select("local_date,category,duration_s,moving_time_s,avg_hr,max_hr,training_load,distance_m,elevation_gain_m,hr_zone_times_s").gte("local_date", since).order("local_date"),
    sb.from("wellness_daily").select("date,resting_hr,hrv,sleep_secs,sleep_score,ctl,atl").gte("date", since).order("date"),
    sb.from("daily_checkins").select("date,energy,fatigue,soreness,sensations").gte("date", since),
    sb.from("planned_sessions").select("date,category,title,duration_min,intensity,status").gte("date", today),
    sb.from("body_measurements").select("measured_on,weight_kg,waist_cm,source").gte("measured_on", since),
    sb.from("coach_messages").select("role,content,created_at").order("created_at", { ascending: false }).limit(12),
  ]);

  // Resumen semanal (lunes a domingo) para que el modelo hable de tendencias sin recalcular.
  const weekOf = (d: string) => {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  };
  const weeks: Record<string, { semana_desde: string; sesiones: number; horas: number; carga: number; km: number }> = {};
  for (const a of (acts.data ?? []) as Record<string, number | string | null>[]) {
    const w = weekOf(String(a.local_date));
    const o = (weeks[w] ??= { semana_desde: w, sesiones: 0, horas: 0, carga: 0, km: 0 });
    o.sesiones += 1;
    o.horas += Number(a.moving_time_s ?? a.duration_s ?? 0) / 3600;
    o.carga += Number(a.training_load ?? 0);
    o.km += Number(a.distance_m ?? 0) / 1000;
  }
  const resumenSemanal = Object.values(weeks).map((o) => ({ ...o, horas: +o.horas.toFixed(1), carga: Math.round(o.carga), km: +o.km.toFixed(1) }));

  const context = { hoy: day, perfil: profile.data, resumen_semanal: resumenSemanal, actividades: acts.data, bienestar: well.data, sensaciones: checks.data, plan: plan.data, mediciones: meas.data };

  // Memoria de conversación: últimos turnos alternando roles, empezando por el usuario.
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of [...(hist.data ?? [])].reverse() as { role: string; content: string }[]) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = String(m.content ?? "").slice(0, 1500);
    if (!content) continue;
    if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].content += `\n${content}`;
    else turns.push({ role, content });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user" || !turns[turns.length - 1].content.includes(q)) turns.push({ role: "user", content: q });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1500,
      system: `${SYSTEM}\n\nDatos actuales del usuario (JSON):\n${JSON.stringify(context)}`,
      messages: turns,
    }),
  });
  if (!r.ok) return Response.json({ content: `El proveedor de IA devolvió un error (${r.status}).` }, { headers: cors });
  const out = await r.json();
  const text: string = out?.content?.[0]?.text ?? "";
  let parsed: { content?: string; proposals?: Record<string, unknown>[] } = {};
  try { parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { parsed = { content: text }; }
  const proposals = (parsed.proposals ?? []).map((p) => ({
    start_time: null, objective: null, warmup: null, main_block: null, cooldown: null, notes: null, completed_activity_id: null,
    ...p, status: "propuesta", origin: "ia",
  }));
  return Response.json({ content: parsed.content ?? "Sin respuesta", payload: proposals.length ? { proposals, rule: "Propuesta de IA (revísala)" } : null }, { headers: cors });
});
