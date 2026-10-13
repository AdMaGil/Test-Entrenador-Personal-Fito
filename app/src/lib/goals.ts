// Objetivos y estado del panel «Hoy».
// Todo se calcula con datos reales; si falta un dato o una meta, se devuelve
// null y la interfaz lo dice en lugar de inventarlo.
import { addDays, diffDays, startOfWeek } from "./dates";
import { isNum } from "./format";
import { realWeights } from "./metrics";
import type { Activity, Measurement, Profile, Wellness } from "./types";

/** Aproximación estándar: ~7700 kcal por kg de masa corporal. Es una orientación, no una regla exacta. */
export const KCAL_PER_KG = 7700;

export interface WeightPlan {
  current: number;
  currentDate: string;
  goal: number;
  /** kg que faltan (positivo = hay que bajar). */
  remaining: number;
  goalDate: string | null;
  daysLeft: number | null;
  /** Ritmo necesario para llegar en fecha (kg/semana, negativo = bajar). */
  neededKgWeek: number | null;
  /** Déficit (o superávit) medio diario que implica ese ritmo. */
  dailyKcal: number | null;
  /** Ritmo real de las últimas semanas (regresión sobre mediciones reales). */
  actualKgWeek: number | null;
  /** Fecha estimada al ritmo real, si va en la dirección correcta. */
  projectedDate: string | null;
  /** Progreso desde la primera medición de la ventana de referencia (0–1). */
  progress: number | null;
  startKg: number | null;
}

/** Pendiente (kg/día) por mínimos cuadrados. Requiere ≥3 mediciones en ≥10 días. */
export function weightSlope(meas: Measurement[], to: string, days = 28): number | null {
  const w = realWeights(meas).filter((m) => m.measured_on <= to && diffDays(to, m.measured_on) < days);
  if (w.length < 3) return null;
  const xs = w.map((m) => diffDays(m.measured_on, w[0].measured_on));
  if (xs[xs.length - 1] < 10) return null;
  const ys = w.map((m) => m.weight_kg as number);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return den ? num / den : null;
}

export function weightPlan(profile: Profile | null, meas: Measurement[], today: string): WeightPlan | null {
  const goal = profile?.weight_goal_kg ?? null;
  const w = realWeights(meas);
  const last = w[w.length - 1];
  if (!isNum(goal) || !last) return null;
  const current = last.weight_kg as number;
  const remaining = current - goal;
  const goalDate = profile?.weight_goal_date && profile.weight_goal_date > today ? profile.weight_goal_date : null;
  const daysLeft = goalDate ? diffDays(goalDate, today) : null;
  const neededKgWeek = daysLeft ? (-remaining / daysLeft) * 7 : null;
  const dailyKcal = daysLeft ? (remaining * KCAL_PER_KG) / daysLeft : null;
  const slope = weightSlope(meas, today);
  const actualKgWeek = slope !== null ? slope * 7 : null;
  // Solo se proyecta si el ritmo real va hacia el objetivo
  const projectedDate = slope !== null && Math.abs(remaining) >= 0.1 && Math.sign(slope) === -Math.sign(remaining) && Math.abs(slope) > 0.005
    ? addDays(last.measured_on, Math.round(Math.abs(remaining / slope)))
    : null;
  // Referencia: la medición más antigua de los últimos 90 días
  const ref = w.find((m) => diffDays(today, m.measured_on) <= 90);
  const startKg = ref && ref !== last ? (ref.weight_kg as number) : null;
  const span = startKg !== null ? startKg - goal : null;
  const progress = startKg !== null && span ? Math.min(1, Math.max(0, (startKg - current) / span)) : null;
  return { current, currentDate: last.measured_on, goal, remaining, goalDate, daysLeft, neededKgWeek, dailyKcal, actualKgWeek, projectedDate, progress, startKg };
}

/** kcal de actividades de un día (estimación del dispositivo). null si ninguna trae dato. */
export function activityKcal(acts: Activity[], from: string, to = from): { kcal: number | null; missing: number; count: number } {
  const rows = acts.filter((a) => a.local_date >= from && a.local_date <= to);
  const withK = rows.filter((a) => isNum(a.calories));
  return {
    kcal: withK.length ? withK.reduce((s, a) => s + (a.calories as number), 0) : null,
    missing: rows.length - withK.length,
    count: rows.length,
  };
}

/** Sesiones realizadas en la semana (lunes a domingo) del día dado. */
export function weekSessions(acts: Activity[], day: string): number {
  const start = startOfWeek(day);
  return acts.filter((a) => a.local_date >= start && a.local_date <= addDays(start, 6)).length;
}

/** Media de sueño (horas) de los últimos n días con dato. */
export function sleepAverage(wellness: Wellness[], today: string, days = 7): { hours: number | null; n: number; last: Wellness | null } {
  const rows = wellness.filter((w) => w.date <= today && diffDays(today, w.date) < days && isNum(w.sleep_secs))
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    hours: rows.length ? rows.reduce((s, w) => s + (w.sleep_secs as number), 0) / rows.length / 3600 : null,
    n: rows.length,
    last: rows[0] ?? null,
  };
}

/** Meta de sesiones: la fijada o, si no hay, los días disponibles del perfil. */
export function sessionsGoal(profile: Profile | null): { value: number | null; fromProfileDays: boolean } {
  if (isNum(profile?.sessions_week_goal)) return { value: profile!.sessions_week_goal as number, fromProfileDays: false };
  const n = profile?.available_days?.length ?? 0;
  return n ? { value: n, fromProfileDays: true } : { value: null, fromProfileDays: false };
}

export interface WeightChartPoint {
  x: string;
  peso: number | null;
  plan: number | null;
}

/**
 * Serie semanal (eje de tiempo uniforme): media real de cada semana y la
 * trayectoria lineal hasta el objetivo desde la última medición.
 */
export function weightChart(meas: Measurement[], today: string, plan: WeightPlan | null, backDays = 90): WeightChartPoint[] {
  const w = realWeights(meas);
  const start = startOfWeek(addDays(today, -backDays));
  const end = plan?.goalDate ? startOfWeek(plan.goalDate) : startOfWeek(today);
  const out: WeightChartPoint[] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) {
    const week = w.filter((m) => m.measured_on >= d && m.measured_on <= addDays(d, 6));
    const peso = week.length ? Math.round((week.reduce((s, m) => s + (m.weight_kg as number), 0) / week.length) * 10) / 10 : null;
    let p: number | null = null;
    if (plan?.goalDate && plan.daysLeft) {
      const lastWeek = startOfWeek(plan.currentDate);
      if (d >= lastWeek) {
        const t = Math.min(1, Math.max(0, diffDays(d, plan.currentDate) / diffDays(plan.goalDate, plan.currentDate)));
        p = Math.round((plan.current + (plan.goal - plan.current) * t) * 10) / 10;
      }
    }
    out.push({ x: d, peso, plan: p });
  }
  return out;
}
