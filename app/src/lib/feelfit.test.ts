import { describe, expect, it } from "vitest";
import { localToUtcIso, parseFeelfit, planImport, toMeasurementInsert } from "./feelfit";
import { FEELFIT_SYNTHETIC_XLSX_BASE64 } from "./feelfit.fixture";
import { realBodyFat, realWeights, rolling7 } from "./metrics";
import type { Measurement } from "./types";
import { readXlsx } from "./xlsx";

function fixtureBuffer(): ArrayBuffer {
  const bin = atob(FEELFIT_SYNTHETIC_XLSX_BASE64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

const meas = (p: Partial<Measurement>): Measurement => ({
  id: Math.random().toString(36), source: "intervals", measured_on: "2026-01-01", weight_kg: null, body_fat_pct: null,
  waist_cm: null, data_origin: "medido", notes: null, last_synced_at: null, ...p,
});

describe("lectura del export de Feelfit", async () => {
  const sheets = await readXlsx(fixtureBuffer());
  const p = parseFeelfit(sheets);

  it("lee el Excel sin dependencias y encuentra la hoja de mediciones", () => {
    expect(sheets.map((s) => s.name)).toContain("Datos de Medición de Peso");
  });

  it("descarta duplicados exactos y filas sin fecha válida", () => {
    expect(p.duplicatesInFile).toBe(1);
    expect(p.invalid).toEqual([{ line: 10, reason: "Fecha y hora no reconocidas" }]);
    expect(p.rows).toHaveLength(8);
  });

  it("un 0 es «sin dato», nunca 0", () => {
    const r = p.rows.find((x) => x.local_time === "2026-01-05 07:30:00");
    expect(r?.body_fat_pct).toBeNull();
    expect(r?.weight_kg).toBe(74.9);
  });

  it("detecta la pesada atípica y la excluye por defecto", () => {
    expect(p.outliers.map((o) => o.row.weight_kg)).toEqual([61]);
    const plan = planImport(p, []);
    expect(plan.excludedOutliers.map((r) => r.weight_kg)).toEqual([61]);
    expect(plan.toInsert).toHaveLength(7);
    // Se puede incluir si decides que sí es tuya
    expect(planImport(p, [], new Set([p.outliers[0].row.external_id])).toInsert).toHaveLength(8);
  });

  it("no importa columnas que no son mediciones útiles", () => {
    expect(p.ignoredColumns).toEqual(expect.arrayContaining(["Puntaje de salud", "Tipo corporal", "Relación de muslo(%)"]));
  });

  it("reimportar el mismo export no añade nada", () => {
    const first = planImport(p, []).toInsert.map((r, i) => ({ ...toMeasurementInsert(r, "Europe/Madrid"), id: `f${i}`, last_synced_at: null }));
    const again = planImport(p, first);
    expect(again.toInsert).toHaveLength(0);
    expect(again.alreadyImported).toBe(7);
  });

  it("convierte la hora local a UTC respetando el horario de verano", () => {
    expect(localToUtcIso("2026-01-01 08:00:00", "Europe/Madrid")).toBe("2026-01-01T07:00:00.000Z");
    expect(localToUtcIso("2026-07-01 08:00:00", "Europe/Madrid")).toBe("2026-07-01T06:00:00.000Z");
  });

  it("unifica con Intervals: misma pesada el mismo día cuenta una vez y se usa la de Feelfit", () => {
    const imported = planImport(p, []).toInsert.map((r, i) => ({ ...toMeasurementInsert(r, "Europe/Madrid"), id: `f${i}`, last_synced_at: null }));
    const all = [
      ...imported,
      meas({ source: "intervals", measured_on: "2026-01-11", weight_kg: 74.8, body_fat_pct: 13.9 }), // coincide → fuera
      meas({ source: "intervals", measured_on: "2026-01-20", weight_kg: 74.0 }), // solo Intervals → se mantiene
    ];
    expect(planImport(p, all).unifiedWithIntervals).toBe(1);
    const daily = realWeights(all);
    expect(daily.filter((m) => m.measured_on === "2026-01-11").map((m) => m.source)).toEqual(["feelfit"]);
    expect(daily.some((m) => m.measured_on === "2026-01-20" && m.source === "intervals")).toBe(true);
  });

  it("varias pesadas el mismo día cuentan como una (la última) en las series diarias", () => {
    const imported = planImport(p, []).toInsert.map((r, i) => ({ ...toMeasurementInsert(r, "Europe/Madrid"), id: `f${i}`, last_synced_at: null }));
    const day = realWeights(imported).filter((m) => m.measured_on === "2026-01-09");
    expect(day.map((m) => m.weight_kg)).toEqual([75.6]);
    // La media de 7 días no se infla con dos pesadas del mismo día
    expect(rolling7(imported).filter((r) => r.date === "2026-01-09")).toHaveLength(1);
    expect(realBodyFat(imported).every((m) => m.body_fat_pct !== null)).toBe(true);
  });

  it("una medición manual prevalece sobre las automáticas del mismo día", () => {
    const daily = realWeights([
      meas({ source: "feelfit", measured_on: "2026-02-01", weight_kg: 75, measured_at: "2026-02-01T07:00:00Z" }),
      meas({ source: "manual", measured_on: "2026-02-01", weight_kg: 75.4, data_origin: "manual" }),
    ]);
    expect(daily.map((m) => m.source)).toEqual(["manual"]);
  });
});
