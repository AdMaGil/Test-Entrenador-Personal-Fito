import { describe, expect, it } from "vitest";
import ejemploB from "../../../docs/wod/ejemplo-b-hyrox-parejas.json";
import {
  describeSetLoad, exerciseVolume, isIncomplete, loadState, normalizeSetForSave, setVolumeKg, totalLoadKg, totalReps,
} from "./loads";
import {
  emptyResult, isResultTouched, newSetFor, normalizeResultForSave, resultFieldsFor, targetHint,
} from "./session";
import type { StrengthSet } from "./types";
import { validateWod } from "./wod";

const base: StrengthSet = { exercise: "Devil press", set_number: 1, reps: null, weight_kg: null, duration_s: null, notes: null };
const set = (p: Partial<StrengthSet>): StrengthSet => ({ ...base, ...p });

describe("cargas", () => {
  it("caso de comprobación: 15 reps con dos mancuernas de 15 kg = 450 kg", () => {
    const s = set({ reps: 15, load_mode: "por_implemento", implements: 2, load_per_implement_kg: 15 });
    expect(totalLoadKg(s)).toBe(30);
    expect(setVolumeKg(s)).toBe(450);
    expect(describeSetLoad(s)).toBe("2 × 15 kg (30 kg)");
  });

  it("las repeticiones por lado cuentan dobles en el volumen", () => {
    const s = set({ reps: 10, reps_scope: "por_lado", load_mode: "por_implemento", implements: 1, load_per_implement_kg: 22.5 });
    expect(totalReps(s)).toBe(20);
    expect(setVolumeKg(s)).toBe(450);
  });

  it("una serie antigua (sin aclarar) muestra su valor pero no calcula volumen", () => {
    const s = set({ reps: 15, weight_kg: 15 });
    expect(loadState(s)).toBe("sin_aclarar");
    expect(setVolumeKg(s)).toBeNull();
    expect(describeSetLoad(s)).toBe("15 kg · sin aclarar");
  });

  it("por tiempo, distancia o calorías no hay volumen en kilos", () => {
    expect(setVolumeKg(set({ duration_s: 40, load_mode: "total", weight_kg: 20 }))).toBeNull();
    expect(setVolumeKg(set({ distance_m: 40, load_mode: "total", weight_kg: 48 }))).toBeNull();
    expect(setVolumeKg(set({ calories: 20, load_mode: "sin_carga" }))).toBeNull();
  });

  it("volumen parcial si falta algún dato y nunca suma un ejercicio sin carga", () => {
    const v = exerciseVolume([
      set({ reps: 10, load_mode: "total", weight_kg: 40 }),
      set({ set_number: 2, reps: 10, load_mode: "total", weight_kg: null }),
    ]);
    expect(v).toEqual({ kg: 400, partial: true, applicable: true });
    expect(exerciseVolume([set({ reps: 20, load_mode: "sin_carga" })]).applicable).toBe(false);
  });

  it("las series pendientes no entran en el volumen", () => {
    const v = exerciseVolume([set({ reps: 10, load_mode: "total", weight_kg: 40, status: "pendiente" })]);
    expect(v.kg).toBeNull();
    expect(v.partial).toBe(true);
  });

  it("al guardar se recalcula el total y se deriva el estado pendiente", () => {
    const ok = normalizeSetForSave(set({ reps: 15, load_mode: "por_implemento", implements: 2, load_per_implement_kg: 15, weight_kg: 999 }));
    expect(ok.weight_kg).toBe(30);
    expect(ok.status).toBe("realizado");
    const missing = normalizeSetForSave(set({ reps: 15, load_mode: "por_implemento", implements: 2, load_per_implement_kg: null }));
    expect(missing.status).toBe("pendiente");
    expect(isIncomplete(set({}))).toBe(true);
    // Registro rápido: solo el peso usado también es un dato válido
    const soloPeso = normalizeSetForSave(set({ load_mode: "total", weight_kg: 40 }));
    expect(soloPeso.status).toBe("realizado");
    expect(setVolumeKg(soloPeso)).toBeNull();
  });

  it("una serie importada con «revisar» sigue pendiente hasta que tiene peso o se marca sin carga", () => {
    const revisar = set({ reps: 15, status: "pendiente" });
    expect(normalizeSetForSave(revisar).status).toBe("pendiente");
    expect(normalizeSetForSave({ ...revisar, load_mode: "total", weight_kg: 30 }).status).toBe("realizado");
    expect(normalizeSetForSave({ ...revisar, load_mode: "sin_carga" }).status).toBe("realizado");
  });

  it("una serie histórica completa no cambia de interpretación al volver a guardar", () => {
    const legacy = set({ reps: 5, weight_kg: 80, status: "realizado" });
    const saved = normalizeSetForSave(legacy);
    expect(saved.load_mode).toBeUndefined();
    expect(saved.weight_kg).toBe(80);
    expect(saved.status).toBe("realizado");
  });
});

describe("previsto frente a realizado", () => {
  const v = validateWod(ejemploB);
  if (!v.ok) throw new Error("ejemplo B inválido");
  const wod = v.wod;
  const devil = wod.bloques[1].ejercicios[1];

  it("una serie nueva no copia el objetivo como resultado", () => {
    const s = newSetFor(devil, { workoutId: "w", blockRef: "b2", setNumber: 1 });
    expect(s.reps).toBeNull();
    expect(s.weight_kg).toBeNull();
    // Solo toma la interpretación explícita del WOD («2 DB»), no un peso
    expect(s.load_mode).toBe("por_implemento");
    expect(s.implements).toBe(2);
    expect(s.load_per_implement_kg).toBeNull();
    expect(targetHint(devil, 0)).toBe("15");
  });

  it("los ejercicios de calorías en máquina no piden carga", () => {
    const ski = wod.bloques[0].ejercicios[0];
    expect(newSetFor(ski, { workoutId: "w", blockRef: "b1", setNumber: 1 }).load_mode).toBe("sin_carga");
  });

  it("los campos de resultado dependen del tipo de bloque", () => {
    expect(resultFieldsFor(wod.bloques[0])).toEqual(["reps", "calories"]); // EMOM max cal + max reps
    expect(resultFieldsFor(wod.bloques[1])).toEqual(["time_s", "rounds", "reps"]); // For Time
    expect(resultFieldsFor(wod.bloques[2])).toEqual([]); // descanso
  });

  it("un bloque sin tocar no se guarda como realizado", () => {
    expect(isResultTouched(emptyResult("w", "b1"))).toBe(false);
  });

  it("en parejas el resultado del equipo no se atribuye a la contribución personal", () => {
    const r = normalizeResultForSave({ ...emptyResult("w", "b2"), status: "realizado", team: { time_s: 170 } }, "parejas");
    expect(r.team).toEqual({ time_s: 170 });
    expect(r.personal).toEqual({});
  });

  it("en individual no se guarda resultado de equipo", () => {
    const r = normalizeResultForSave({ ...emptyResult("w", "b1"), status: "realizado", personal: { rounds: 5 }, team: { rounds: 9 } }, "individual");
    expect(r.team).toEqual({});
    expect(r.personal).toEqual({ rounds: 5 });
  });
});
