// Cargas y volumen sin ambigüedad.
//
//   * La carga externa total = peso por implemento × nº de implementos
//     («2 × 15 kg» = 30 kg), o el total indicado directamente.
//   * Una serie antigua (load_mode NULL) tiene la carga «sin aclarar»: se
//     muestra su valor original pero NO entra en cálculos ni comparaciones.
//   * Volumen = repeticiones totales × carga externa total, solo si ambos
//     están resueltos. Las series por tiempo, distancia o calorías no tienen
//     volumen en kilos. Nunca se deduce nada del nombre del ejercicio.
import type { LoadMode, StrengthSet } from "./types";

const kgFmt = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
export const fmtKg = (n: number) => kgFmt.format(n);

export type LoadState = "resuelta" | "sin_carga" | "sin_aclarar" | "falta_dato";

export function loadState(s: StrengthSet): LoadState {
  const mode = s.load_mode ?? null;
  if (mode === null) return "sin_aclarar";
  if (mode === "sin_carga") return "sin_carga";
  return totalLoadKg(s) === null ? "falta_dato" : "resuelta";
}

/** Carga externa total en kg, o null si no está resuelta. */
export function totalLoadKg(s: StrengthSet): number | null {
  if (s.load_mode === "por_implemento") {
    if (s.implements && s.load_per_implement_kg && s.load_per_implement_kg > 0) return round2(s.implements * s.load_per_implement_kg);
    return null;
  }
  if (s.load_mode === "total") return s.weight_kg !== null && s.weight_kg > 0 ? s.weight_kg : null;
  return null;
}

/** Repeticiones totales (por lado × 2). null si no hay repeticiones. */
export function totalReps(s: StrengthSet): number | null {
  if (s.reps === null || s.reps === undefined) return null;
  return s.reps_scope === "por_lado" ? s.reps * 2 : s.reps;
}

/** La serie se mide por tiempo, distancia o calorías en vez de repeticiones. */
export function isNonRepSet(s: StrengthSet): boolean {
  return (s.reps === null || s.reps === undefined) && (Boolean(s.duration_s) || Boolean(s.distance_m) || Boolean(s.calories));
}

/** Volumen de una serie en kg, o null si no es calculable o no aplica. */
export function setVolumeKg(s: StrengthSet): number | null {
  if (isNonRepSet(s)) return null;
  const load = totalLoadKg(s);
  const reps = totalReps(s);
  if (load === null || reps === null) return null;
  return round2(load * reps);
}

/**
 * Volumen de un ejercicio (nunca se suman ejercicios distintos).
 * partial = hay series realizadas con carga que no se han podido calcular.
 */
export function exerciseVolume(sets: StrengthSet[]): { kg: number | null; partial: boolean; applicable: boolean } {
  const done = sets.filter((s) => s.status !== "pendiente");
  const loaded = done.filter((s) => s.load_mode !== "sin_carga" && !isNonRepSet(s));
  if (!loaded.length) return { kg: null, partial: sets.some((s) => s.status === "pendiente"), applicable: false };
  let kg = 0, any = false, partial = sets.some((s) => s.status === "pendiente");
  for (const s of loaded) {
    const v = setVolumeKg(s);
    if (v === null) partial = true; else { kg += v; any = true; }
  }
  return { kg: any ? round2(kg) : null, partial, applicable: true };
}

/** Texto de la carga, p. ej. «2 × 15 kg (30 kg)», «Sin carga», «15 kg · sin aclarar». */
export function describeSetLoad(s: StrengthSet): string | null {
  switch (loadState(s)) {
    case "sin_carga": return "Sin carga";
    case "sin_aclarar": return s.weight_kg !== null && s.weight_kg !== undefined ? `${fmtKg(s.weight_kg)} kg · sin aclarar` : null;
    case "falta_dato": return null;
    case "resuelta": {
      const total = totalLoadKg(s) as number;
      if (s.load_mode === "por_implemento" && s.implements && s.load_per_implement_kg) {
        return s.implements > 1 ? `${s.implements} × ${fmtKg(s.load_per_implement_kg)} kg (${fmtKg(total)} kg)` : `${fmtKg(s.load_per_implement_kg)} kg (1 implemento)`;
      }
      return `${fmtKg(total)} kg`;
    }
  }
}

/** Texto del trabajo de la serie con su unidad. */
export function describeSetWork(s: StrengthSet): string | null {
  const parts: string[] = [];
  if (s.reps !== null && s.reps !== undefined) parts.push(`${s.reps} reps${s.reps_scope === "por_lado" ? " por lado" : ""}`);
  if (s.duration_s) parts.push(`${s.duration_s} s`);
  if (s.distance_m) parts.push(`${fmtKg(s.distance_m)} m`);
  if (s.calories) parts.push(`${fmtKg(s.calories)} cal`);
  return parts.length ? parts.join(" · ") : null;
}

/** Normaliza una serie antes de guardar: recalcula el total y deriva el estado pendiente. */
export function normalizeSetForSave(s: StrengthSet): StrengthSet {
  const out: StrengthSet = { ...s, exercise: s.exercise.trim() };
  if (out.load_mode === "por_implemento") {
    out.weight_kg = totalLoadKg(out);
  } else if (out.load_mode === "total") {
    out.implements = null;
    out.load_per_implement_kg = null;
  } else if (out.load_mode === "sin_carga") {
    out.weight_kg = null;
    out.implements = null;
    out.load_per_implement_kg = null;
  }
  out.status = isIncomplete(out) || (s.status === "pendiente" && out.weight_kg == null && out.load_mode !== "sin_carga") ? "pendiente" : "realizado";
  return out;
}

/** Falta el dato principal o la carga indicada está incompleta. */
export function isIncomplete(s: StrengthSet): boolean {
  const hasWork = s.reps != null || Boolean(s.duration_s) || Boolean(s.distance_m) || Boolean(s.calories);
  if (!hasWork) return true;
  if (s.load_mode === "total" && (s.weight_kg == null || s.weight_kg <= 0) && !isNonRepSet(s)) return true;
  if (s.load_mode === "por_implemento" && totalLoadKg(s) === null) return true;
  return false;
}

export const LOAD_MODE_LABEL: Record<LoadMode, string> = {
  total: "kg total",
  por_implemento: "kg c/u",
  sin_carga: "sin carga",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
