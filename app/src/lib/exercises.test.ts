import { describe, expect, it } from "vitest";
import { canonicalName, compareLastTwo, exerciseCatalog, exerciseKey, exerciseSessions, lastTime, sessionPoints } from "./exercises";
import ejemploA from "../../../docs/wod/ejemplo-a-hyrox.json";
import { activityPending, activityWodInfo, hasPending } from "./pending";
import type { StrengthEntry, Workout } from "./types";
import { validateWod } from "./wod";

let n = 0;
const e = (p: Partial<StrengthEntry>): StrengthEntry => ({
  id: `s${++n}`, date: "2026-10-01", activity_id: "a1", exercise: "Sentadilla trasera", set_number: 1,
  reps: 5, weight_kg: null, duration_s: null, notes: null, status: "realizado", ...p,
});
const total = (kg: number) => ({ load_mode: "total" as const, weight_kg: kg });

describe("nombres", () => {
  it("normaliza espacios y mayúsculas sin fusionar variantes", () => {
    expect(exerciseKey("  sentadilla   TRASERA ")).toBe("sentadilla trasera");
    const cat = exerciseCatalog([e({ exercise: "Sentadilla trasera" }), e({ exercise: "sentadilla  trasera", date: "2026-10-05" }), e({ exercise: "Sentadilla frontal" })]);
    expect(cat.map((c) => c.key)).toEqual(["sentadilla frontal", "sentadilla trasera"]);
    expect(canonicalName("SENTADILLA frontal", cat)).toBe("Sentadilla frontal");
    expect(canonicalName("Peso muerto", cat)).toBe("Peso muerto");
  });
});

describe("última vez", () => {
  const hist = [
    e({ date: "2026-09-20", activity_id: "x", ...total(80) }),
    e({ date: "2026-10-01", activity_id: "y", ...total(82.5) }),
    e({ date: "2026-10-08", activity_id: "actual", ...total(85) }),
  ];
  it("devuelve la sesión anterior, no la actual", () => {
    const last = lastTime(hist, "sentadilla trasera", { activityId: "actual", date: "2026-10-08" });
    expect(last?.date).toBe("2026-10-01");
    expect(last?.sets[0].weight_kg).toBe(82.5);
  });
  it("sin histórico devuelve null (primer registro)", () => {
    expect(lastTime(hist, "remo con barra", { activityId: "actual", date: "2026-10-08" })).toBeNull();
  });
  it("marca como ambiguo el histórico con carga sin aclarar", () => {
    const last = lastTime([e({ date: "2026-09-01", activity_id: "x", weight_kg: 15 })], "sentadilla trasera", { activityId: "z", date: "2026-10-08" });
    expect(last?.ambiguous).toBe(true);
  });
  it("las series pendientes no cuentan", () => {
    expect(lastTime([e({ date: "2026-09-01", activity_id: "x", status: "pendiente", ...total(90) })], "sentadilla trasera", { activityId: "z", date: "2026-10-08" })).toBeNull();
  });
});

describe("comparación", () => {
  it("con las mismas repeticiones da la diferencia directa de carga", () => {
    const s = exerciseSessions([
      e({ date: "2026-09-20", activity_id: "x", ...total(80) }),
      e({ date: "2026-10-01", activity_id: "y", ...total(82.5) }),
    ], "sentadilla trasera");
    expect(compareLastTwo(s)).toMatchObject({ kind: "mismas_reps", reps: 5, deltaKg: 2.5 });
  });

  it("si cambian las repeticiones muestra ambas sin veredicto", () => {
    const s = exerciseSessions([
      e({ date: "2026-09-20", activity_id: "x", reps: 8, ...total(70) }),
      e({ date: "2026-10-01", activity_id: "y", reps: 5, ...total(80) }),
    ], "sentadilla trasera");
    const c = compareLastTwo(s);
    expect(c.kind).toBe("reps_distintas");
  });

  it("no compara repeticiones por lado con totales", () => {
    const s = exerciseSessions([
      e({ date: "2026-09-20", activity_id: "x", reps: 10, reps_scope: "por_lado", ...total(20) }),
      e({ date: "2026-10-01", activity_id: "y", reps: 10, reps_scope: "total", ...total(24) }),
    ], "sentadilla trasera");
    expect(compareLastTwo(s).kind).toBe("reps_distintas");
  });

  it("excluye registros ambiguos de la comparación y de la gráfica", () => {
    const s = exerciseSessions([
      e({ date: "2026-09-20", activity_id: "x", weight_kg: 80 }), // sin aclarar
      e({ date: "2026-10-01", activity_id: "y", ...total(82.5) }),
    ], "sentadilla trasera");
    expect(compareLastTwo(s).kind).toBe("insuficiente");
    expect(sessionPoints(s)).toEqual([{ date: "2026-10-01", kg: 82.5, reps: 5 }]);
  });

  it("dos mancuernas se comparan por su carga total", () => {
    const s = exerciseSessions([
      e({ date: "2026-09-20", activity_id: "x", exercise: "Devil press", reps: 15, load_mode: "por_implemento", implements: 2, load_per_implement_kg: 12.5 }),
      e({ date: "2026-10-01", activity_id: "y", exercise: "Devil press", reps: 15, load_mode: "por_implemento", implements: 2, load_per_implement_kg: 15 }),
    ], "devil press");
    expect(compareLastTwo(s)).toMatchObject({ kind: "mismas_reps", prevKg: 25, lastKg: 30, deltaKg: 5 });
  });
});


describe("registro pendiente", () => {
  const v = validateWod(ejemploA);
  if (!v.ok) throw new Error("ejemplo A inválido");
  const w: Workout = { id: "w1", client_ref: "r1", activity_id: "a1", planned_session_id: null, title: "HYROX", wod_date: null,
    modality: null, spec: v.wod, source_text: null, superseded_at: null, created_at: "2026-10-12T10:00:00Z" };
  const base = { workouts: [w], blockResults: [], strengthSets: [], resultsReady: true };

  it("una actividad sin WOD ni series no está pendiente (bici, carrera…)", () => {
    expect(hasPending(activityPending(base, "bici"))).toBe(false);
  });
  it("un WOD vinculado sin resultado está pendiente", () => {
    expect(activityPending(base, "a1")).toEqual({ blocks: 1, sets: 0 });
  });
  it("marcar el bloque como hecho o no hecho lo resuelve", () => {
    const r = { workout_id: "w1", block_ref: "b1", status: "no_realizado" as const, personal: {}, team: {}, rpe: null, adaptations: null, notes: null };
    expect(hasPending(activityPending({ ...base, blockResults: [r] }, "a1"))).toBe(false);
  });
  it("una serie con peso «revisar» queda pendiente", () => {
    expect(activityPending({ ...base, workouts: [], strengthSets: [e({ activity_id: "a2", status: "pendiente" })] }, "a2")).toEqual({ blocks: 0, sets: 1 });
  });
  it("da título y etiquetas para el listado", () => {
    expect(activityWodInfo(base, "a1")).toEqual({ title: "HYROX", tags: ["For Time"] });
  });
});
