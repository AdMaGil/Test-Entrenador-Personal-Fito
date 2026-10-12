// Ejercicios: nombres normalizados, «Última vez» y comparación honesta.
//
//   * Solo se normalizan espacios y mayúsculas («sentadilla  trasera» =
//     «Sentadilla trasera»). Variantes distintas (p. ej. «Sentadilla frontal»)
//     nunca se fusionan solas.
//   * La referencia «Última vez» se muestra, pero no se registra como resultado.
//   * Solo se comparan series realizadas con la carga resuelta, la misma
//     interpretación de repeticiones y las mismas repeticiones. Si cambian las
//     repeticiones se muestran ambas sin afirmar que hay mejora.
import { describeSetLoad, describeSetWork, loadState, totalLoadKg } from "./loads";
import type { StrengthEntry, StrengthSet } from "./types";

export function exerciseKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Catálogo a partir del histórico: una entrada por clave, con la grafía más reciente. */
export function exerciseCatalog(entries: StrengthEntry[]): { key: string; name: string; sessions: number }[] {
  const byKey = new Map<string, { name: string; date: string; dates: Set<string> }>();
  for (const e of entries) {
    const key = exerciseKey(e.exercise);
    if (!key) continue;
    const cur = byKey.get(key);
    if (!cur) byKey.set(key, { name: e.exercise.trim().replace(/\s+/g, " "), date: e.date, dates: new Set([e.date]) });
    else {
      cur.dates.add(e.date);
      if (e.date > cur.date) { cur.name = e.exercise.trim().replace(/\s+/g, " "); cur.date = e.date; }
    }
  }
  return [...byKey.entries()].map(([key, v]) => ({ key, name: v.name, sessions: v.dates.size }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Devuelve el nombre ya existente si solo difiere en espacios o mayúsculas. */
export function canonicalName(name: string, catalog: { key: string; name: string }[]): string {
  const clean = name.trim().replace(/\s+/g, " ");
  const hit = catalog.find((c) => c.key === exerciseKey(clean));
  return hit ? hit.name : clean;
}

export interface ExerciseSession {
  date: string;
  activityId: string | null;
  /** Series realizadas (las pendientes no cuentan). */
  sets: StrengthEntry[];
  /** Alguna serie tiene la carga sin aclarar o le falta un dato de carga. */
  ambiguous: boolean;
}

/** Sesiones de un ejercicio, de la más reciente a la más antigua. */
export function exerciseSessions(entries: StrengthEntry[], key: string, opts: { from?: string; to?: string } = {}): ExerciseSession[] {
  const byS = new Map<string, ExerciseSession>();
  for (const e of entries) {
    if (exerciseKey(e.exercise) !== key || e.status === "pendiente") continue;
    if (opts.from && e.date < opts.from) continue;
    if (opts.to && e.date > opts.to) continue;
    const id = `${e.date}|${e.activity_id ?? ""}`;
    const s = byS.get(id) ?? { date: e.date, activityId: e.activity_id ?? null, sets: [], ambiguous: false };
    s.sets.push(e);
    const ls = loadState(e);
    if (ls === "sin_aclarar" || ls === "falta_dato") s.ambiguous = true;
    byS.set(id, s);
  }
  for (const s of byS.values()) s.sets.sort((a, b) => a.set_number - b.set_number);
  return [...byS.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Última sesión anterior del ejercicio (excluye la actividad actual). */
export function lastTime(entries: StrengthEntry[], key: string, current: { activityId: string; date: string }): ExerciseSession | null {
  return exerciseSessions(entries, key, { to: current.date }).find((s) => s.activityId !== current.activityId) ?? null;
}

/** Texto compacto de una serie: «15 reps · 2 × 15 kg (30 kg)». */
export function describeSet(s: StrengthSet): string {
  return [describeSetWork(s), describeSetLoad(s)].filter(Boolean).join(" · ") || "Sin datos";
}

/** Firma de comparabilidad: misma interpretación de repeticiones y carga resuelta. */
function comparable(s: StrengthSet): boolean {
  return s.status !== "pendiente" && s.reps != null && loadState(s) === "resuelta";
}

export type Comparison =
  | { kind: "insuficiente"; message: string }
  | { kind: "mismas_reps"; reps: number; scope: "total" | "por_lado"; prevKg: number; lastKg: number; deltaKg: number; prevDate: string; lastDate: string }
  | { kind: "reps_distintas"; prev: string; last: string; prevDate: string; lastDate: string };

/**
 * Compara las dos sesiones más recientes con series comparables.
 * Con repeticiones equivalentes: diferencia directa de carga (la mayor carga a esas repeticiones).
 * Con repeticiones distintas: ambos resultados, sin veredicto.
 */
export function compareLastTwo(sessions: ExerciseSession[]): Comparison {
  const usable = sessions.map((s) => ({ ...s, sets: s.sets.filter(comparable) })).filter((s) => s.sets.length);
  if (usable.length < 2) return { kind: "insuficiente", message: "Registra otra sesión para comparar." };
  const [last, prev] = usable;
  const keyOf = (s: StrengthSet) => `${s.reps}|${s.reps_scope ?? "total"}`;
  const best = (sets: StrengthSet[]) => {
    const m = new Map<string, number>();
    for (const s of sets) { const k = keyOf(s); m.set(k, Math.max(m.get(k) ?? 0, totalLoadKg(s) as number)); }
    return m;
  };
  const bl = best(last.sets), bp = best(prev.sets);
  const common = [...bl.keys()].filter((k) => bp.has(k));
  if (common.length) {
    // Las repeticiones comunes más altas: el dato más representativo del trabajo de la sesión
    const k = common.sort((a, b) => Number(b.split("|")[0]) - Number(a.split("|")[0]))[0];
    const [reps, scope] = k.split("|");
    const lastKg = bl.get(k) as number, prevKg = bp.get(k) as number;
    return { kind: "mismas_reps", reps: Number(reps), scope: scope as "total" | "por_lado", prevKg, lastKg,
      deltaKg: Math.round((lastKg - prevKg) * 100) / 100, prevDate: prev.date, lastDate: last.date };
  }
  const summary = (sets: StrengthSet[]) => sets.map(describeSet).join("; ");
  return { kind: "reps_distintas", prev: summary(prev.sets), last: summary(last.sets), prevDate: prev.date, lastDate: last.date };
}

/** Puntos para la gráfica: carga máxima resuelta por sesión, con sus repeticiones (solo series comparables). */
export function sessionPoints(sessions: ExerciseSession[]): { date: string; kg: number; reps: number }[] {
  const out: { date: string; kg: number; reps: number }[] = [];
  for (const s of [...sessions].reverse()) {
    const sets = s.sets.filter(comparable);
    if (!sets.length) continue;
    const top = sets.reduce((a, b) => ((totalLoadKg(b) as number) > (totalLoadKg(a) as number) ? b : a));
    out.push({ date: s.date, kg: totalLoadKg(top) as number, reps: top.reps as number });
  }
  return out;
}
