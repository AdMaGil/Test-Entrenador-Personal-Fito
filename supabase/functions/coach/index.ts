// Función de servidor «coach» (opcional, desactivada por defecto).
//
// Solo se usa si se despliega en Supabase y se configura el secreto
// ANTHROPIC_API_KEY (y la variable VITE_COACH_AI_ENABLED=true en la web).
// La clave del proveedor nunca llega al navegador. El contexto se construye
// con datos estructurados del propio usuario (leídos con su sesión y RLS);
// las fotografías NO forman parte del contexto.
//
// Despliegue:  supabase functions deploy coach
//              supabase secrets set ANTHROPIC_API_KEY=...  [COACH_MODEL=...]
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const MODEL = Deno.env.get("COACH_MODEL") ?? "claude-sonnet-5";
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
  const since = new Date(Date.now() - 42 * 86400000).toISOString().slice(0, 10);
  const [profile, acts, well, checks, plan, meas] = await Promise.all([
    sb.from("profiles").select("goals,available_days,session_minutes_default,sport_priority,equipment,limitations,preferences,hr_max_bpm,weight_goal_kg").maybeSingle(),
    sb.from("activities").select("local_date,category,duration_s,moving_time_s,avg_hr,max_hr,training_load,distance_m,elevation_gain_m,hr_zone_times_s").gte("local_date", since).order("local_date"),
    sb.from("wellness_daily").select("date,resting_hr,hrv,sleep_secs,sleep_score,ctl,atl").gte("date", since).order("date"),
    sb.from("daily_checkins").select("date,energy,fatigue,soreness,sensations").gte("date", since),
    sb.from("planned_sessions").select("date,category,title,duration_min,intensity,status").gte("date", today),
    sb.from("body_measurements").select("measured_on,weight_kg,waist_cm,source").gte("measured_on", since),
  ]);
  const context = { hoy: today, perfil: profile.data, actividades: acts.data, bienestar: well.data, sensaciones: checks.data, plan: plan.data, mediciones: meas.data };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1500, system: SYSTEM,
      messages: [{ role: "user", content: `Datos (JSON):\n${JSON.stringify(context)}\n\nPregunta: ${String(message).slice(0, 2000)}` }],
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
