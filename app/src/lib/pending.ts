// Registro pendiente: solo cuando hay algo EXPLÍCITAMENTE pendiente.
//   * un WOD vinculado con bloques PUNTUABLES (AMRAP, For Time) sin resultado
//     (ni «Hecho» ni «No hecho»); EMOM, rondas y descansos no piden resultado, o
//   * series marcadas como pendientes (p. ej. peso «revisar»).
// Una actividad sin series ni WOD (bici, carrera, sesión sin carga) NO se
// considera incompleta.
import type { DataBundle, Workout } from "./types";
import { isScoredBlock, structureSummary, wodTags } from "./wod";

export interface ActivityPending {
  blocks: number;
  sets: number;
}

type Data = Pick<DataBundle, "workouts" | "blockResults" | "strengthSets" | "resultsReady">;

export function activeWorkoutsOf(data: Pick<DataBundle, "workouts">, activityId: string): Workout[] {
  return data.workouts.filter((w) => w.activity_id === activityId && !w.superseded_at);
}

export function activityPending(data: Data, activityId: string): ActivityPending {
  let blocks = 0;
  if (data.resultsReady) {
    for (const w of activeWorkoutsOf(data, activityId)) {
      for (const b of w.spec.bloques) {
        if (!isScoredBlock(b)) continue;
        const r = data.blockResults.find((x) => x.workout_id === w.id && x.block_ref === b.id);
        if (!r || r.status === null) blocks++;
      }
    }
  }
  const sets = data.strengthSets.filter((s) => s.activity_id === activityId && s.status === "pendiente").length;
  return { blocks, sets };
}

export const hasPending = (p: ActivityPending) => p.blocks + p.sets > 0;

export function describePending(p: ActivityPending): string {
  const parts: string[] = [];
  if (p.blocks) parts.push(`${p.blocks} bloque${p.blocks > 1 ? "s" : ""} sin resultado`);
  if (p.sets) parts.push(`${p.sets} serie${p.sets > 1 ? "s" : ""} con datos pendientes`);
  return parts.join(" · ");
}

/** Título reconocible y etiquetas para listados (del WOD vinculado, si existe). */
export function activityWodInfo(data: Pick<DataBundle, "workouts">, activityId: string): { title: string | null; tags: string[] } {
  const ws = activeWorkoutsOf(data, activityId);
  if (!ws.length) return { title: null, tags: [] };
  const tags = new Set<string>();
  for (const w of ws) for (const t of wodTags(w.spec)) tags.add(t);
  // «HYROX» (o similar genérico) no distingue un día de otro: se usa la estructura
  const name = (w: Workout) => (w.title && !/^hyrox$/i.test(w.title.trim()) ? w.title : structureSummary(w.spec) || w.title);
  return { title: ws.map(name).filter(Boolean).join(" + ") || null, tags: [...tags] };
}

export function unlinkedWorkouts(data: Pick<DataBundle, "workouts">): Workout[] {
  return data.workouts.filter((w) => !w.activity_id && !w.superseded_at);
}
