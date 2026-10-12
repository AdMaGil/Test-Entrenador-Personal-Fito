// Registro pendiente: solo cuando hay algo EXPLÍCITAMENTE pendiente.
//   * un WOD vinculado con bloques sin resultado (ni «Hecho» ni «No hecho»), o
//   * series marcadas como pendientes (p. ej. peso «revisar»).
// Una actividad sin series ni WOD (bici, carrera, sesión sin carga) NO se
// considera incompleta.
import type { DataBundle, Workout } from "./types";
import { wodTags } from "./wod";

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
        if (b.tipo === "descanso") continue;
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
  return { title: ws.map((w) => w.title).filter(Boolean).join(" + ") || null, tags: [...tags] };
}

export function unlinkedWorkouts(data: Pick<DataBundle, "workouts">): Workout[] {
  return data.workouts.filter((w) => !w.activity_id && !w.superseded_at);
}
