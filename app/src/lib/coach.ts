// «Mi entrenador» sin IA: reglas explícitas y comprensibles.
//
// Nada de lo que hay aquí pretende ser un entrenador inteligente. Cada
// propuesta indica qué regla la ha generado y qué datos ha usado, y nunca
// se añade al calendario sin que el usuario la revise.

import { addDays, diffDays, dowLong, fmtDay, isoWeekday, weekDays } from "./dates";
import { fmtDuration, fmtNum, isNum, pctChange } from "./format";
import {
  consecutiveHardDays, durationOf, inRange, intensityBucket, lastWith, personalBaseline, realWeights,
  summarize, weightTrend,
} from "./metrics";
import { SPORT_LABEL } from "./sports";
import type {
  Activity, Checkin, Intensity, PlanCategory, PlannedDraft, PlannedSession, Profile, Sport, Wellness,
} from "./types";

export interface CoachContext {
  today: string;
  profile: Profile | null;
  activities: Activity[];
  wellness: Wellness[];
  checkins: Checkin[];
  planned: PlannedSession[];
}

export interface Suggestion {
  kind: "planificada" | "sugerencia" | "insuficiente";
  session: PlannedDraft | PlannedSession | null;
  rule: string;
  reasons: string[];
  dataUsed: string[];
}

const LOWER: Record<Intensity, Intensity> = { alta: "moderada", moderada: "suave", suave: "suave" };

function hasEquipment(profile: Profile | null, item: string): boolean {
  return !!profile?.equipment?.some((e) => e.toLowerCase().includes(item));
}

// ---------------------------------------------------------------------------
// Plantillas de sesión (contenido explícito, escalado a la duración)
// ---------------------------------------------------------------------------
export function buildSession(
  category: PlanCategory,
  intensity: Intensity,
  minutes: number,
  date: string,
  profile: Profile | null,
  location?: PlannedSession["location"],
): PlannedDraft {
  const warm = Math.max(5, Math.round(minutes * 0.15));
  const cool = Math.max(5, Math.round(minutes * 0.1));
  const main = Math.max(5, minutes - warm - cool);
  const rack = hasEquipment(profile, "rack");
  const bar = hasEquipment(profile, "barra");
  const pulley = hasEquipment(profile, "polea");

  const base: Omit<PlannedDraft, "title" | "objective" | "warmup" | "main_block" | "cooldown"> = {
    date, start_time: null, category, duration_min: minutes, intensity,
    location: location ?? (category === "hiit" || category === "otro" ? "casa" : "exterior"),
    status: "propuesta", origin: "reglas", rationale: null, completed_activity_id: null, notes: null,
  };

  if (category === "hiit") {
    const strength = bar && rack
      ? "sentadilla con barra en rack, press militar y peso muerto rumano"
      : bar ? "peso muerto rumano y press con barra" : "sentadilla, zancadas y flexiones";
    const pull = pulley ? "remo en polea con agarres individuales" : "remo con banda o mochila";
    if (intensity === "suave") {
      return { ...base, title: "Fuerza técnica y movilidad",
        objective: "Mantener el estímulo de fuerza con baja fatiga y trabajar la técnica.",
        warmup: `${warm} min: movilidad de cadera, tobillo y columna torácica; activación de glúteo.`,
        main_block: `${main} min: 3 bloques a ritmo cómodo (RPE 5–6) de ${strength} y ${pull}, 8–10 repeticiones con descanso completo. Prioriza la técnica sobre la carga.`,
        cooldown: `${cool} min: respiración diafragmática y estiramientos suaves.` };
    }
    if (intensity === "moderada") {
      return { ...base, title: "Circuito funcional EMOM",
        objective: "Capacidad aeróbica y fuerza resistencia sin llegar al máximo.",
        warmup: `${warm} min: movilidad dinámica y 2 rondas progresivas del circuito con carga ligera.`,
        main_block: `${main} min en EMOM alternando ${strength}, ${pull} y burpees. Trabajo de 35–40 s por minuto (RPE 7).`,
        cooldown: `${cool} min: caminar o pedalear suave y estiramientos.` };
    }
    return { ...base, title: "HIIT tipo Hyrox",
      objective: "Estímulo de alta intensidad: potencia y tolerancia al esfuerzo.",
      warmup: `${warm} min: progresivo hasta ritmo de trabajo, incluyendo 2 series de aproximación.`,
      main_block: `${main} min: 4–6 bloques de 4 min (thrusters con ${bar ? "barra" : "peso corporal"}, ${pull}, burpees y zancadas) con 2 min de recuperación. RPE 8–9.`,
      cooldown: `${cool} min: vuelta a la calma progresiva y movilidad.` };
  }

  if (category === "emtb" || category === "mtb") {
    const bike = category === "emtb" ? "e-MTB" : "MTB";
    const assist = category === "emtb"
      ? { suave: "asistencia media/alta para mantener la FC en Z1–Z2", moderada: "asistencia baja/media; la FC manda, no la velocidad", alta: "asistencia mínima en las subidas de trabajo" }
      : { suave: "desarrollos ligeros y cadencia ágil", moderada: "ritmo constante en las subidas", alta: "subidas exigentes con recuperación completa" };
    const target = { suave: "Z1–Z2", moderada: "Z2–Z3", alta: "Z4 en los bloques de trabajo" }[intensity];
    return { ...base, title: `${bike} ${intensity === "alta" ? "subidas de calidad" : intensity === "moderada" ? "fondo Z2–Z3" : "rodaje suave"}`,
      objective: category === "emtb"
        ? `Estímulo cardiovascular controlado por frecuencia cardiaca (${target}). En e-MTB, la velocidad y la distancia dependen de la asistencia y no indican por sí solas una mejora física.`
        : `Trabajo aeróbico y técnico en montaña (${target}).`,
      warmup: `${warm} min: llano o pista a ritmo cómodo, cadencia alta.`,
      main_block: `${main} min con ${assist[intensity]}. ${intensity === "alta" ? "4–6 subidas de 4–6 min con bajada suave como recuperación." : "Mantén un esfuerzo constante y conversacional."}`,
      cooldown: `${cool} min: rodar muy suave hasta casa.` };
  }

  if (category === "run") {
    return { ...base, title: intensity === "alta" ? "Series de carrera" : intensity === "moderada" ? "Carrera a ritmo controlado" : "Rodaje suave",
      objective: intensity === "suave" ? "Base aeróbica con bajo impacto acumulado." : "Mejorar el ritmo sostenido sin acumular demasiada fatiga.",
      warmup: `${warm} min: trote suave y 4 progresivos cortos.`,
      main_block: intensity === "alta"
        ? `${main} min: 6–8 × 2 min a ritmo exigente con 2 min de trote.`
        : `${main} min a ritmo ${intensity === "moderada" ? "cómodamente exigente (RPE 6–7)" : "conversacional (RPE 4–5)"}.`,
      cooldown: `${cool} min: trote muy suave y caminar.` };
  }

  if (category === "descanso") {
    return { ...base, intensity: "suave", duration_min: null, title: "Descanso",
      objective: "Recuperación.", warmup: null, main_block: "Sin entrenamiento planificado.", cooldown: null };
  }

  return { ...base, category: "otro", intensity: "suave", title: "Movilidad y descanso activo",
    objective: "Favorecer la recuperación sin añadir carga relevante.",
    warmup: `${warm} min: caminar o pedalear muy suave.`,
    main_block: `${main} min: movilidad de cadera, columna y hombros; estiramientos en polea si está disponible.`,
    cooldown: `${cool} min: respiración y relajación.` };
}

// ---------------------------------------------------------------------------
// Sugerencia del día
// ---------------------------------------------------------------------------
function defaultMinutes(profile: Profile | null): number {
  return profile?.session_minutes_default ?? 45;
}

function priorityRotation(profile: Profile | null, acts: Activity[], today: string): { sport: Sport; why: string } {
  const prio = (profile?.sport_priority?.length ? profile.sport_priority : ["hiit", "emtb", "mtb", "run"]) as Sport[];
  const main = prio.slice(0, 2);
  // Elige, entre los dos deportes prioritarios, el que lleve más días sin practicarse
  const daysSince = (s: Sport) => {
    const last = acts.filter((a) => a.category === s && a.local_date < today).sort((a, b) => b.local_date.localeCompare(a.local_date))[0];
    return last ? diffDays(today, last.local_date) : 999;
  };
  const pick = main.reduce((a, b) => (daysSince(b) > daysSince(a) ? b : a));
  const d = daysSince(pick);
  return { sport: pick, why: d === 999 ? `No hay sesiones recientes de ${SPORT_LABEL[pick]}.` : `${SPORT_LABEL[pick]} es prioritario y lleva ${d} días sin practicarse.` };
}

export function suggestToday(ctx: CoachContext, overrides: { minutes?: number; location?: PlannedSession["location"]; sleptBadly?: boolean; sport?: Sport } = {}): Suggestion {
  const { today, profile, activities, wellness, checkins, planned } = ctx;
  const dataUsed: string[] = [];

  const plannedToday = planned.find((p) => p.date === today && p.status === "planificada");
  if (plannedToday && !overrides.minutes && !overrides.location && !overrides.sleptBadly && !overrides.sport) {
    return { kind: "planificada", session: plannedToday, rule: "Sesión ya planificada para hoy",
      reasons: ["Tienes esta sesión en tu calendario. No se modifica automáticamente."], dataUsed: ["Calendario"] };
  }

  const checkin = checkins.find((c) => c.date === today);
  const recent = inRange(activities, addDays(today, -28), addDays(today, -1));
  const sleep = lastWith(wellness, "sleep_secs", today);
  const hrv = personalBaseline(wellness, "hrv", today);
  const lastFit = lastWith(wellness, "ctl", today);

  if (!recent.length && !checkin && !overrides.sport) {
    return { kind: "insuficiente", session: null, rule: "Datos insuficientes",
      reasons: ["No hay actividades en las últimas 4 semanas ni registro de sensaciones de hoy.",
        "Registra cómo te encuentras o planifica la sesión manualmente."], dataUsed: [] };
  }

  const reasons: string[] = [];
  let intensity: Intensity = "moderada";
  let rule = "Rotación por prioridades";
  let sport: Sport | "otro" = overrides.sport ?? priorityRotation(profile, activities, today).sport;
  if (!overrides.sport) reasons.push(priorityRotation(profile, activities, today).why);
  else reasons.push(`Has pedido una sesión de ${SPORT_LABEL[overrides.sport]}.`);

  if (recent.length) dataUsed.push(`${recent.length} actividades de los últimos 28 días`);

  // Regla 1: sensaciones de hoy
  if (checkin) {
    dataUsed.push("Registro de sensaciones de hoy");
    if ((checkin.fatigue ?? 0) >= 4 || (checkin.energy ?? 5) <= 2) {
      intensity = "suave";
      rule = "Fatiga alta o energía baja en tu registro de hoy";
      reasons.push("Has indicado fatiga alta o energía baja: se propone una sesión suave.");
      if ((checkin.fatigue ?? 0) >= 5) {
        sport = "otro";
        reasons.push("Con fatiga máxima, la propuesta es descanso activo.");
      }
    }
    if (checkin.soreness.length && !checkin.soreness.includes("ninguna")) {
      reasons.push(`Has registrado molestias (${checkin.soreness.join(", ")}): evita cargar esa zona y ajusta si es necesario.`);
    }
  }

  // Regla 2: días seguidos de alta intensidad
  const hardStreak = consecutiveHardDays(activities, today);
  const yesterday = activities.filter((a) => a.local_date === addDays(today, -1));
  if (hardStreak >= 2) {
    intensity = "suave";
    rule = "Varios días seguidos de intensidad alta";
    reasons.push(`Llevas ${hardStreak} días seguidos con sesiones de intensidad alta (≥20 % del tiempo en Z4 o superior).`);
  } else if (yesterday.some((a) => intensityBucket(a) === "alta")) {
    // No se sube a «alta»: como máximo moderada tras un día intenso
    reasons.push("Ayer hiciste una sesión de intensidad alta: hoy como máximo moderada.");
  } else if (intensity === "moderada" && !checkin?.fatigue && recent.length >= 4) {
    const daysSinceHard = recent.filter((a) => intensityBucket(a) === "alta").map((a) => diffDays(today, a.local_date));
    if (!daysSinceHard.length || Math.min(...daysSinceHard) >= 3) {
      intensity = "alta";
      reasons.push("No hay sesiones intensas en los últimos 3 días.");
    }
  }

  // Regla 3: sueño
  if (overrides.sleptBadly) {
    intensity = LOWER[intensity];
    rule = "Has indicado que has dormido poco";
    reasons.push("Has indicado que has dormido poco: se reduce un nivel la intensidad.");
  } else if (sleep && diffDays(today, sleep.date) <= 1 && isNum(sleep.sleep_secs)) {
    dataUsed.push(`Sueño del ${fmtDay(sleep.date)}`);
    if (sleep.sleep_secs < 6 * 3600) {
      intensity = LOWER[intensity];
      reasons.push(`Dormiste ${fmtDuration(sleep.sleep_secs)} (menos de 6 h): se reduce un nivel la intensidad.`);
    }
  }

  // Dato informativo: HRV frente a tu histórico (no es un diagnóstico)
  if (hrv) {
    dataUsed.push(`HRV frente a tus ${hrv.n} días previos`);
    if (hrv.position === "por debajo") {
      reasons.push("Tu HRV de hoy está por debajo de tu rango habitual. Es un dato a tener en cuenta, no un diagnóstico.");
      if (intensity === "alta") intensity = "moderada";
    }
  }
  if (lastFit && isNum(lastFit.ctl) && isNum(lastFit.atl)) dataUsed.push("Aptitud y fatiga estimadas por Intervals.icu");

  const minutes = overrides.minutes ?? defaultMinutes(profile);
  const location = overrides.location ?? (sport === "hiit" || sport === "otro" ? "casa" : "exterior");
  if (overrides.location === "casa" && (sport === "emtb" || sport === "mtb" || sport === "run")) {
    reasons.push("Adaptada a casa: se sustituye por trabajo funcional con tu material.");
    sport = "hiit";
  }
  if (overrides.minutes) reasons.push(`Ajustada a ${overrides.minutes} minutos.`);

  const session = buildSession(sport, intensity, minutes, today, profile, location);
  session.rationale = reasons.join(" ");
  return { kind: "sugerencia", session, rule, reasons, dataUsed };
}

// ---------------------------------------------------------------------------
// Reorganizar la semana: propone cambios, no los aplica
// ---------------------------------------------------------------------------
export function reorganizeWeek(ctx: CoachContext): { changes: { id: string; from: string; to: string; title: string }[]; notes: string[] } {
  const { today, profile, planned } = ctx;
  const days = weekDays(today).filter((d) => d >= today);
  const available = profile?.available_days?.length ? profile.available_days : [1, 2, 3, 4, 5, 6, 7];
  const pending = planned.filter((p) => p.status === "planificada" && p.category !== "descanso");
  const notes: string[] = [];
  const changes: { id: string; from: string; to: string; title: string }[] = [];

  // Sesiones atrasadas de esta semana que no se hicieron
  const overdue = pending.filter((p) => p.date < today && p.date >= weekDays(today)[0]);
  const thisWeek = pending.filter((p) => p.date >= today && p.date <= days[days.length - 1]);
  const occupied = new Map<string, PlannedSession[]>();
  for (const p of thisWeek) occupied.set(p.date, [...(occupied.get(p.date) ?? []), p]);

  const isHard = (p: PlannedSession) => p.intensity === "alta";
  const slots = days.filter((d) => available.includes(isoWeekday(d)));

  for (const p of [...overdue, ...thisWeek.filter((x) => !available.includes(isoWeekday(x.date)))]) {
    const free = slots.find((d) => {
      if ((occupied.get(d) ?? []).length) return false;
      if (!isHard(p)) return true;
      const prev = occupied.get(addDays(d, -1)) ?? [];
      const next = occupied.get(addDays(d, 1)) ?? [];
      return ![...prev, ...next].some(isHard);
    });
    if (free) {
      changes.push({ id: p.id, from: p.date, to: free, title: p.title });
      occupied.set(free, [p]);
    } else {
      notes.push(`No hay un día libre disponible para «${p.title}» esta semana.`);
    }
  }

  // Dos sesiones intensas en días consecutivos
  const sorted = [...occupied.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (let i = 1; i < sorted.length; i++) {
    const [d, list] = sorted[i];
    const [prevD, prevList] = sorted[i - 1];
    if (diffDays(d, prevD) === 1 && list.some(isHard) && prevList.some(isHard)) {
      notes.push(`Tienes dos sesiones intensas seguidas (${dowLong(prevD)} y ${dowLong(d)}). Valora bajar la intensidad de una.`);
    }
  }
  if (!changes.length && !notes.length) notes.push("Tu semana ya encaja con tus días disponibles; no se proponen cambios.");
  if (!profile?.available_days?.length) notes.push("No has configurado días disponibles: se consideran todos los días.");
  return { changes, notes };
}

// ---------------------------------------------------------------------------
// Explicación de la evolución (descriptiva, sin conclusiones causales)
// ---------------------------------------------------------------------------
export function explainProgress(ctx: CoachContext): string[] {
  const { today, activities, wellness } = ctx;
  const curr = summarize(inRange(activities, addDays(today, -27), today));
  const prev = summarize(inRange(activities, addDays(today, -55), addDays(today, -28)));
  const lines: string[] = [];
  if (!curr.sessions && !prev.sessions) return ["Aún no hay actividades suficientes para describir tu evolución."];

  lines.push(`Últimos 28 días: ${curr.sessions} sesiones y ${fmtDuration(curr.timeS)} de entrenamiento` +
    (prev.sessions ? `, frente a ${prev.sessions} sesiones y ${fmtDuration(prev.timeS)} en los 28 días anteriores.` : ". No hay datos del periodo anterior para comparar."));
  if (curr.load !== null && prev.load !== null && prev.load > 0) {
    const ch = pctChange(curr.load, prev.load) as number;
    lines.push(`La carga registrada ha ${ch >= 0 ? "subido" : "bajado"} un ${fmtNum(Math.abs(ch))} %.`);
  }
  const bySport = Object.entries(curr.bySport).filter(([, v]) => v.sessions > 0)
    .map(([s, v]) => `${SPORT_LABEL[s as Sport]}: ${v.sessions} (${fmtDuration(v.timeS, { short: true })})`);
  if (bySport.length) lines.push(`Reparto por deporte: ${bySport.join(" · ")}.`);

  const fit = wellness.filter((w) => isNum(w.ctl) && w.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const last = fit[fit.length - 1];
  const ref = fit.find((w) => w.date >= addDays(today, -28));
  if (last && ref && last !== ref) {
    const d = (last.ctl as number) - (ref.ctl as number);
    lines.push(`La aptitud estimada por Intervals.icu (media de 42 días de tu carga) ha pasado de ${fmtNum(ref.ctl, 0)} a ${fmtNum(last.ctl, 0)} (${d >= 0 ? "+" : "−"}${fmtNum(Math.abs(d), 0)}). Es una estimación basada solo en la carga registrada.`);
  }
  return lines;
}

export function explainWeight(measurements: Parameters<typeof weightTrend>[0]): string | null {
  const t = weightTrend(measurements);
  const n = realWeights(measurements).length;
  if (!t) return n ? `Solo hay ${n} medición(es) de peso real; no basta para hablar de tendencia.` : null;
  return `Peso: ${t.deltaKg >= 0 ? "+" : "−"}${fmtNum(Math.abs(t.deltaKg), 1)} kg entre el ${fmtDay(t.fromDate)} y el ${fmtDay(t.toDate)} (solo mediciones reales). Un cambio así no permite atribuir causas por sí solo.`;
}

export function activityMinutes(a: Activity): number {
  return Math.round((durationOf(a) ?? 0) / 60);
}
