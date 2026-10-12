import { addDays, diffDays, rangeDays, startOfWeek } from "./dates";
import { isNum, mean, stdev, sum } from "./format";
import type { Activity, Intensity, Measurement, PlannedSession, Sport, StrengthEntry, Wellness } from "./types";
import { SPORTS } from "./sports";

export function durationOf(a: Activity): number | null {
  return isNum(a.moving_time_s) ? a.moving_time_s : isNum(a.duration_s) ? a.duration_s : null;
}

export function inRange<T extends { local_date?: string; date?: string }>(rows: T[], from: string, to: string): T[] {
  return rows.filter((r) => {
    const d = (r.local_date ?? r.date) as string;
    return d >= from && d <= to;
  });
}

/** Suma solo si existe al menos un valor real; si no hay ninguno devuelve null («Sin datos»). */
export function sumOrNull(values: (number | null | undefined)[]): number | null {
  return values.some(isNum) ? sum(values) : null;
}

export function zoneTotals(acts: Activity[]): number[] | null {
  const withZones = acts.filter((a) => a.hr_zone_times_s && a.hr_zone_times_s.length);
  if (!withZones.length) return null;
  const n = Math.max(...withZones.map((a) => a.hr_zone_times_s!.length));
  const out = Array<number>(n).fill(0);
  for (const a of withZones) a.hr_zone_times_s!.forEach((v, i) => (out[i] += v || 0));
  return out;
}

/** Baja = Z1–Z2 · Media = Z3–Z4 · Alta = Z5 en adelante (zonas de FC de Intervals.icu) */
export function intensityMix(zones: number[] | null): { low: number; mid: number; high: number; total: number } | null {
  if (!zones) return null;
  const total = zones.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const low = (zones[0] ?? 0) + (zones[1] ?? 0);
  const mid = (zones[2] ?? 0) + (zones[3] ?? 0);
  const high = zones.slice(4).reduce((a, b) => a + b, 0);
  return { low: low / total, mid: mid / total, high: high / total, total };
}

/**
 * Intensidad de una sesión a partir del tiempo en zonas de FC.
 * Regla explícita: ≥20 % del tiempo en Z4 o superior → alta; ≥8 % → moderada; resto → suave.
 * Sin zonas → null («Sin datos»).
 */
export function intensityBucket(a: Activity): Intensity | null {
  const z = a.hr_zone_times_s;
  if (!z || !z.length) return null;
  const total = z.reduce((x, y) => x + y, 0);
  if (!total) return null;
  const hard = z.slice(3).reduce((x, y) => x + y, 0) / total;
  if (hard >= 0.2) return "alta";
  if (hard >= 0.08) return "moderada";
  return "suave";
}

export interface WeekSummary {
  start: string;
  timeS: number;
  sessions: number;
  bySport: Record<Sport, { sessions: number; timeS: number; load: number }>;
  load: number | null;
  calories: number | null;
  zones: number[] | null;
  plannedTotal: number;
  plannedDone: number;
  elevationM: number | null;
}

export function emptyBySport(): Record<Sport, { sessions: number; timeS: number; load: number }> {
  return Object.fromEntries(SPORTS.map((s) => [s, { sessions: 0, timeS: 0, load: 0 }])) as Record<
    Sport,
    { sessions: number; timeS: number; load: number }
  >;
}

export function summarize(acts: Activity[]) {
  const bySport = emptyBySport();
  for (const a of acts) {
    const b = bySport[a.category];
    b.sessions++;
    b.timeS += durationOf(a) ?? 0;
    b.load += a.training_load ?? 0;
  }
  return {
    timeS: sum(acts.map(durationOf)),
    sessions: acts.length,
    bySport,
    load: sumOrNull(acts.map((a) => a.training_load)),
    calories: sumOrNull(acts.map((a) => a.calories)),
    zones: zoneTotals(acts),
    elevationM: sumOrNull(acts.map((a) => a.elevation_gain_m)),
  };
}

export function weekSummary(acts: Activity[], planned: PlannedSession[], anyDay: string): WeekSummary {
  const start = startOfWeek(anyDay);
  const end = addDays(start, 6);
  const wActs = inRange(acts, start, end);
  const wPlan = planned.filter((p) => p.date >= start && p.date <= end && p.category !== "descanso" &&
    (p.status === "planificada" || p.status === "completada"));
  return {
    start,
    ...summarize(wActs),
    plannedTotal: wPlan.length,
    plannedDone: wPlan.filter((p) => p.status === "completada").length,
  };
}

// ---------------------------------------------------------------------------
// Peso: solo mediciones reales
// ---------------------------------------------------------------------------
/**
 * Una medición por día, sin duplicados entre orígenes:
 *   * Una pesada de Intervals que coincide (mismo día, ±0,1 kg) con una de Feelfit
 *     es la misma medición: se usa la de Feelfit (trae composición). La de Intervals
 *     no se borra; solo queda fuera de los cálculos.
 *   * Si un día hay varias pesadas, cuenta una: la manual si existe; si no, la última
 *     de Feelfit (como hacía Intervals); si no, la de Intervals.
 */
export function dailyMeasurements(meas: Measurement[]): Measurement[] {
  const feelfitByDay = new Map<string, Measurement[]>();
  for (const m of meas) if (m.source === "feelfit") feelfitByDay.set(m.measured_on, [...(feelfitByDay.get(m.measured_on) ?? []), m]);
  const rank = (m: Measurement) => (m.source === "manual" ? 3 : m.source === "feelfit" ? 2 : 1);
  const byDay = new Map<string, Measurement>();
  for (const m of meas) {
    if (m.source === "intervals" && isNum(m.weight_kg)
      && (feelfitByDay.get(m.measured_on) ?? []).some((f) => isNum(f.weight_kg) && Math.abs((f.weight_kg as number) - (m.weight_kg as number)) <= 0.1 + 1e-9)) continue;
    const cur = byDay.get(m.measured_on);
    if (!cur || rank(m) > rank(cur) || (rank(m) === rank(cur) && (m.measured_at ?? "") > (cur.measured_at ?? ""))) byDay.set(m.measured_on, m);
  }
  return [...byDay.values()].sort((a, b) => a.measured_on.localeCompare(b.measured_on));
}

export function realWeights(meas: Measurement[]): Measurement[] {
  return dailyMeasurements(meas.filter((m) => isNum(m.weight_kg)));
}

export interface WeightTrend {
  deltaKg: number;
  fromDate: string;
  toDate: string;
}

/** Diferencia entre la última medición y la medición real más cercana a 7–30 días antes. */
export function weightTrend(meas: Measurement[]): WeightTrend | null {
  const w = realWeights(meas);
  if (w.length < 2) return null;
  const last = w[w.length - 1];
  const candidates = w.filter((m) => {
    const d = diffDays(last.measured_on, m.measured_on);
    return d >= 7 && d <= 30;
  });
  if (!candidates.length) return null;
  const ref = candidates.reduce((best, m) =>
    Math.abs(diffDays(last.measured_on, m.measured_on) - 7) < Math.abs(diffDays(last.measured_on, best.measured_on) - 7) ? m : best);
  return { deltaKg: (last.weight_kg as number) - (ref.weight_kg as number), fromDate: ref.measured_on, toDate: last.measured_on };
}

/** Media de 7 días: solo si hay al menos 3 mediciones reales en la ventana. */
export function rolling7(meas: Measurement[]): { date: string; value: number | null }[] {
  const w = realWeights(meas);
  return w.map((m) => {
    const win = w.filter((x) => {
      const d = diffDays(m.measured_on, x.measured_on);
      return d >= 0 && d < 7;
    });
    return { date: m.measured_on, value: win.length >= 3 ? mean(win.map((x) => x.weight_kg)) : null };
  });
}

export function nearestMeasurement(meas: Measurement[], date: string, maxDays = 3): Measurement | null {
  const w = realWeights(meas).filter((m) => Math.abs(diffDays(m.measured_on, date)) <= maxDays);
  if (!w.length) return null;
  return w.reduce((best, m) =>
    Math.abs(diffDays(m.measured_on, date)) < Math.abs(diffDays(best.measured_on, date)) ? m : best);
}

// ---------------------------------------------------------------------------
// % de grasa corporal: solo mediciones reales (de Feelfit, directamente desde su
// export o vía Intervals.icu, que no expone el resto de métricas de la báscula).
// ---------------------------------------------------------------------------
export function realBodyFat(meas: Measurement[]): Measurement[] {
  return dailyMeasurements(meas.filter((m) => isNum(m.body_fat_pct)));
}

export function nearestBodyFat(meas: Measurement[], date: string, maxDays = 3): Measurement | null {
  const w = realBodyFat(meas).filter((m) => Math.abs(diffDays(m.measured_on, date)) <= maxDays);
  if (!w.length) return null;
  return w.reduce((best, m) =>
    Math.abs(diffDays(m.measured_on, date)) < Math.abs(diffDays(best.measured_on, date)) ? m : best);
}

// ---------------------------------------------------------------------------
// Recuperación: comparación con el histórico propio, sin umbrales universales
// ---------------------------------------------------------------------------
export interface Baseline {
  value: number;
  date: string;
  mean: number;
  sd: number;
  n: number;
  position: "dentro" | "por debajo" | "por encima";
}

/**
 * Compara el último valor con tu propio histórico de los 30 días previos
 * (media ± 1 desviación típica). Requiere al menos 7 valores previos.
 */
export function personalBaseline(
  wellness: Wellness[],
  field: "hrv" | "resting_hr",
  today: string,
): Baseline | null {
  const valid = wellness.filter((w) => isNum(w[field]) && w.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  if (!valid.length) return null;
  const last = valid[valid.length - 1];
  if (diffDays(today, last.date) > 2) return null;
  const prior = valid.filter((w) => w.date < last.date && diffDays(last.date, w.date) <= 30).map((w) => w[field] as number);
  if (prior.length < 7) return null;
  const m = mean(prior) as number;
  const sd = stdev(prior) as number;
  const v = last[field] as number;
  const position = v < m - sd ? "por debajo" : v > m + sd ? "por encima" : "dentro";
  return { value: v, date: last.date, mean: m, sd, n: prior.length, position };
}

export function lastWith<K extends keyof Wellness>(wellness: Wellness[], field: K, today: string): Wellness | null {
  const rows = wellness.filter((w) => w.date <= today && w[field] !== null && w[field] !== undefined)
    .sort((a, b) => b.date.localeCompare(a.date));
  return rows[0] ?? null;
}

export interface FitnessPoint {
  date: string;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
}

export function fitnessSeries(wellness: Wellness[], from: string, to: string): FitnessPoint[] {
  const byDate = new Map(wellness.map((w) => [w.date, w]));
  return rangeDays(from, to).map((d) => {
    const w = byDate.get(d);
    const ctl = w && isNum(w.ctl) ? w.ctl : null;
    const atl = w && isNum(w.atl) ? w.atl : null;
    return { date: d, ctl, atl, tsb: ctl !== null && atl !== null ? ctl - atl : null };
  });
}

export function sleepStats(wellness: Wellness[], from: string, to: string) {
  const rows = inRange(wellness, from, to).filter((w) => isNum(w.sleep_secs));
  const secs = rows.map((w) => w.sleep_secs as number);
  return {
    nights: rows.length,
    meanSecs: mean(secs),
    sdSecs: stdev(secs),
    meanScore: mean(rows.map((w) => w.sleep_score)),
  };
}

export interface Period {
  from: string;
  to: string;
}

export function previousPeriod(p: Period): Period {
  const len = diffDays(p.to, p.from) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

/** Sesiones comparables: mismo deporte, ordenadas por fecha. */
export function similarSessions(acts: Activity[], ref: Activity, limit = 6): Activity[] {
  return acts
    .filter((a) => a.id !== ref.id && a.category === ref.category && a.local_date <= ref.local_date)
    .sort((a, b) => b.local_date.localeCompare(a.local_date))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Fuerza: evolución del peso máximo usado por ejercicio y sesión
// ---------------------------------------------------------------------------
export function exerciseNames(sets: StrengthEntry[]): string[] {
  return [...new Set(sets.map((s) => s.exercise.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
}

/** Para un ejercicio, el peso máximo registrado por fecha (una serie por día). */
export function exerciseTrend(sets: StrengthEntry[], exercise: string): { date: string; weight_kg: number }[] {
  const byDate = new Map<string, number>();
  for (const s of sets) {
    if (s.exercise.trim() !== exercise || !isNum(s.weight_kg)) continue;
    const prev = byDate.get(s.date);
    if (prev === undefined || s.weight_kg > prev) byDate.set(s.date, s.weight_kg);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, weight_kg]) => ({ date, weight_kg }));
}

export function consecutiveHardDays(acts: Activity[], today: string): number {
  let n = 0;
  for (let d = addDays(today, -1); ; d = addDays(d, -1)) {
    const day = acts.filter((a) => a.local_date === d);
    if (day.some((a) => intensityBucket(a) === "alta")) n++;
    else break;
    if (n > 14) break;
  }
  return n;
}
