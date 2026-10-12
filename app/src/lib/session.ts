// Registro de lo REALIZADO frente a lo PREVISTO.
//
// El WOD importado es la prescripción. Nada de él se convierte en resultado
// por sí solo: los objetivos se muestran como referencia (p. ej. como texto
// de ayuda en el campo vacío), y solo lo que el usuario escribe se guarda.
// En parejas nunca se reparte el resultado del equipo entre los dos.
import type { BlockResult, ResultMetrics, StrengthSet } from "./types";
import type { WodBlock, WodItem, WodSpec } from "./wod";

export type MetricKey = keyof Required<ResultMetrics>;

export const METRIC_LABEL: Record<MetricKey, { label: string; unit: string }> = {
  time_s: { label: "Tiempo final", unit: "" },
  rounds: { label: "Rondas", unit: "rondas" },
  reps: { label: "Repeticiones", unit: "reps" },
  calories: { label: "Calorías", unit: "cal" },
  distance_m: { label: "Distancia", unit: "m" },
};

/** Campos de resultado relevantes para el tipo de bloque (formulario corto). */
export function resultFieldsFor(b: WodBlock): MetricKey[] {
  const units = new Set(b.ejercicios.map((e) => e.objetivo?.tipo).filter(Boolean));
  const hasCal = units.has("calorias") || units.has("max_calorias");
  const hasReps = units.has("reps") || units.has("max_reps");
  switch (b.tipo) {
    case "descanso": return [];
    case "for_time": return ["time_s", "rounds", "reps"];
    case "amrap": return ["rounds", "reps"];
    case "emom": {
      const out: MetricKey[] = [];
      if (hasReps || !hasCal) out.push("reps");
      if (hasCal) out.push("calories");
      return out;
    }
    case "rondas": return ["rounds", "time_s"];
    default: return ["time_s", "rounds", "reps"].filter((k) => k !== "reps" || hasReps) as MetricKey[];
  }
}

export function emptyResult(workoutId: string, blockRef: string): BlockResult {
  return { workout_id: workoutId, block_ref: blockRef, status: null, personal: {}, team: {}, rpe: null, adaptations: null, notes: null };
}

export function resultKey(r: { workout_id: string; block_ref: string }): string {
  return `${r.workout_id}:${r.block_ref}`;
}

/** Elimina claves vacías; un 0 introducido explícitamente se conserva (p. ej. 0 rondas extra). */
export function cleanMetrics(m: ResultMetrics): ResultMetrics {
  const out: ResultMetrics = {};
  for (const [k, v] of Object.entries(m) as [MetricKey, number | null | undefined][]) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

export function hasAnyMetric(m: ResultMetrics): boolean {
  return Object.keys(cleanMetrics(m)).length > 0;
}

/** Un resultado se guarda solo si el usuario ha escrito o marcado algo. */
export function isResultTouched(r: BlockResult): boolean {
  return r.status !== null || hasAnyMetric(r.personal) || hasAnyMetric(r.team) || r.rpe !== null || Boolean(r.adaptations) || Boolean(r.notes);
}

export function normalizeResultForSave(r: BlockResult, modality: WodSpec["modalidad"]): BlockResult {
  return {
    ...r,
    personal: cleanMetrics(r.personal),
    // El resultado de equipo solo existe en parejas
    team: modality === "parejas" ? cleanMetrics(r.team) : {},
    adaptations: r.adaptations?.trim() || null,
    notes: r.notes?.trim() || null,
  };
}

/** Bloque realizado con datos pendientes: marcado como hecho pero sin ningún dato personal ni de equipo. */
export function resultNeedsData(r: BlockResult | undefined, b: WodBlock): boolean {
  if (b.tipo === "descanso") return false;
  if (!r || r.status === null) return true;
  return false;
}

// ---------------------------------------------------------------------
// Series a partir de un ejercicio previsto
// ---------------------------------------------------------------------
/** Unidad principal de trabajo para registrar el ejercicio. */
export function workUnitFor(item: WodItem | null): "reps" | "segundos" | "metros" | "calorias" {
  switch (item?.objetivo?.tipo) {
    case "segundos": return "segundos";
    case "metros": return "metros";
    case "calorias": case "max_calorias": return "calorias";
    default: return "reps";
  }
}

/** ¿Tiene sentido registrar carga en este ejercicio? Solo se oculta si el objetivo es de calorías (máquina). */
export function loadRelevant(item: WodItem | null): boolean {
  return workUnitFor(item) !== "calorias";
}

/**
 * Nueva serie vacía enlazada al ejercicio previsto. NO copia el objetivo como
 * resultado: el objetivo se muestra aparte como referencia.
 * Solo toma del WOD la interpretación de la carga cuando el WOD la indica
 * explícitamente (p. ej. «2 DB» → por implemento, 2 implementos).
 */
export function newSetFor(item: WodItem | null, ctx: { workoutId: string | null; blockRef: string | null; setNumber: number; exercise?: string }): StrengthSet {
  const c = item?.carga;
  const perImpl = c?.modo === "por_implemento" || (c?.implementos !== null && c?.implementos !== undefined && c.implementos > 1 && c.modo !== "total");
  return {
    exercise: ctx.exercise ?? item?.nombre ?? "",
    exercise_original: null,
    set_number: ctx.setNumber,
    reps: null, weight_kg: null, duration_s: null, distance_m: null, calories: null, notes: null,
    status: "realizado",
    workout_id: ctx.workoutId, block_ref: ctx.blockRef, item_ref: item?.id ?? null,
    load_mode: !loadRelevant(item) ? "sin_carga" : perImpl ? "por_implemento" : "total",
    implements: perImpl ? (c?.implementos ?? null) : null,
    load_per_implement_kg: null,
    reps_scope: item?.objetivo?.por_lado ? "por_lado" : "total",
  };
}

/** Copia de una serie para «Duplicar serie» (siguiente número). */
export function duplicateSet(s: StrengthSet, setNumber: number): StrengthSet {
  const { id: _id, ...rest } = s;
  void _id;
  return { ...rest, set_number: setNumber };
}

/** Referencia del objetivo previsto para la serie n (progresión por ronda si existe). */
export function targetHint(item: WodItem | null, setIndex: number): string | null {
  const t = item?.objetivo;
  if (!t) return null;
  if (t.por_ronda?.length) return t.por_ronda[setIndex] !== undefined ? String(t.por_ronda[setIndex]) : null;
  if (t.valor !== null) return String(t.valor);
  return null;
}

/** Siguiente número de serie para un ejercicio. */
export function nextSetNumber(sets: StrengthSet[], match: (s: StrengthSet) => boolean): number {
  return sets.filter(match).reduce((m, s) => Math.max(m, s.set_number), 0) + 1;
}
