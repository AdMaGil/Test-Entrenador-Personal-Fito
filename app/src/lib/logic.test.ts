import { describe, expect, it } from "vitest";
import { buildSession, reorganizeWeek, suggestToday, type CoachContext } from "./coach";
import { addDays, isoWeekday, monthWeeks, startOfWeek, todayISO, weekDays } from "./dates";
import { fmtDuration, fmtNum, MISSING } from "./format";
import {
  intensityBucket, nearestMeasurement, personalBaseline, rolling7, summarize, weightTrend,
} from "./metrics";
import type { Activity, Measurement, PlannedSession, Profile, Wellness } from "./types";

const act = (over: Partial<Activity>): Activity => ({
  id: Math.random().toString(36), source: "intervals", external_id: "x", data_origin: "medido", start_time: null,
  local_date: "2026-10-05", name: null, source_type: null, category_auto: "hiit", category_ambiguous: false,
  category_override: null, category: "hiit", category_needs_review: false, duration_s: 3000, moving_time_s: 2900,
  distance_m: null, elevation_gain_m: null, avg_hr: 130, max_hr: 170, avg_speed_ms: null, max_speed_ms: null,
  avg_cadence: null, rider_avg_power_w: null, rider_power_source: null, training_load: 40, intensity: null, trimp: null,
  calories: null, hr_zone_times_s: null, hr_zone_bounds: null, device_name: null, has_gps: false, has_heartrate: true,
  stream_types: null, api_restricted: false, last_synced_at: null, ...over,
});
const meas = (d: string, w: number | null): Measurement => ({
  id: d, source: "intervals", measured_on: d, weight_kg: w, body_fat_pct: null, waist_cm: null, data_origin: "medido", notes: null, last_synced_at: null,
});
const profile: Profile = {
  user_id: "u", display_name: null, timezone: "Europe/Madrid", units: { weight: "kg", distance: "km", elevation: "m" }, theme: "dark",
  goals: null, weight_goal_kg: null, hr_max_bpm: null, available_days: [1, 3, 5], session_minutes_default: 40,
  sport_priority: ["hiit", "emtb", "mtb", "run"], equipment: ["Rack", "Barra olímpica", "Polea con agarres individuales"], limitations: null, preferences: null,
};

describe("fechas (lunes a domingo, Europe/Madrid)", () => {
  it("la semana empieza en lunes", () => {
    expect(startOfWeek("2026-10-11")).toBe("2026-10-05"); // domingo → lunes anterior
    expect(isoWeekday("2026-10-11")).toBe(7);
    expect(weekDays("2026-10-07")[6]).toBe("2026-10-11");
  });
  it("las semanas del mes cubren el mes completo", () => {
    const w = monthWeeks("2026-10-15");
    expect(w[0][0]).toBe("2026-09-28");
    expect(w[w.length - 1][6] >= "2026-10-31").toBe(true);
  });
  it("hoy en Madrid cerca de medianoche UTC", () => {
    expect(todayISO("Europe/Madrid", new Date("2026-10-11T22:30:00Z"))).toBe("2026-10-12");
  });
});

describe("datos ausentes", () => {
  it("se muestran como «Sin datos», nunca como cero", () => {
    expect(fmtNum(null)).toBe(MISSING);
    expect(fmtDuration(undefined)).toBe(MISSING);
    expect(summarize([act({ calories: null })]).calories).toBeNull();
    expect(summarize([act({ training_load: null })]).load).toBeNull();
  });
});

describe("intensidad por zonas", () => {
  it("clasifica con reglas explícitas", () => {
    expect(intensityBucket(act({ hr_zone_times_s: [100, 100, 100, 100, 0, 0, 0] }))).toBe("alta");
    expect(intensityBucket(act({ hr_zone_times_s: [500, 300, 120, 80, 0, 0, 0] }))).toBe("moderada");
    expect(intensityBucket(act({ hr_zone_times_s: [800, 200, 0, 0, 0, 0, 0] }))).toBe("suave");
    expect(intensityBucket(act({ hr_zone_times_s: null }))).toBeNull();
  });
});

describe("peso: solo mediciones reales", () => {
  it("una sola medición no da tendencia", () => {
    expect(weightTrend([meas("2026-10-11", 80.1)])).toBeNull();
  });
  it("ignora días sin peso y compara con ~7 días antes", () => {
    const m = [meas("2026-09-30", 80.6), meas("2026-10-02", null), meas("2026-10-04", 80.4), meas("2026-10-11", 80.1)];
    const t = weightTrend(m)!;
    expect(t.fromDate).toBe("2026-10-04");
    expect(t.deltaKg).toBeCloseTo(-0.3, 5);
  });
  it("media de 7 días solo con al menos 3 mediciones", () => {
    const r = rolling7([meas("2026-10-01", 80), meas("2026-10-05", 79.8), meas("2026-10-06", 79.6)]);
    expect(r[0].value).toBeNull();
    expect(r[1].value).toBeNull();
    expect(r[2].value).toBeCloseTo(79.8, 5);
  });
  it("asocia la medición real más cercana a ±3 días", () => {
    const m = [meas("2026-10-01", 80), meas("2026-10-11", 79)];
    expect(nearestMeasurement(m, "2026-10-09")?.measured_on).toBe("2026-10-11");
    expect(nearestMeasurement(m, "2026-10-06")).toBeNull();
  });
});

describe("HRV frente al histórico propio", () => {
  it("requiere al menos 7 valores previos", () => {
    const w: Wellness[] = Array.from({ length: 5 }, (_, i) => ({ date: addDays("2026-10-11", -i), hrv: 50 } as Wellness));
    expect(personalBaseline(w, "hrv", "2026-10-11")).toBeNull();
  });
  it("detecta un valor por debajo del rango propio", () => {
    const w = Array.from({ length: 15 }, (_, i) => ({ date: addDays("2026-10-10", -i), hrv: 55 + (i % 3) } as Wellness));
    w.push({ date: "2026-10-11", hrv: 40 } as Wellness);
    expect(personalBaseline(w, "hrv", "2026-10-11")?.position).toBe("por debajo");
  });
});

describe("Mi entrenador (reglas)", () => {
  const base: CoachContext = { today: "2026-10-11", profile, activities: [], wellness: [], checkins: [], planned: [] };

  it("sin datos indica que no puede sugerir", () => {
    expect(suggestToday(base).kind).toBe("insuficiente");
  });
  it("respeta la sesión ya planificada", () => {
    const p = { id: "p1", date: "2026-10-11", status: "planificada", category: "emtb", title: "Salida" } as PlannedSession;
    const s = suggestToday({ ...base, planned: [p], activities: [act({ local_date: "2026-10-09" })] });
    expect(s.kind).toBe("planificada");
    expect(s.session).toBe(p);
  });
  it("fatiga alta → sesión suave y como propuesta, nunca planificada directamente", () => {
    const s = suggestToday({ ...base, activities: [act({ local_date: "2026-10-08" })],
      checkins: [{ date: "2026-10-11", energy: 3, fatigue: 4, soreness: [], sensations: null }] });
    expect(s.session?.intensity).toBe("suave");
    expect(s.session?.status).toBe("propuesta");
  });
  it("dormir poco baja un nivel", () => {
    const acts = [act({ local_date: "2026-10-01", category: "emtb" }), act({ local_date: "2026-10-03", category: "hiit" })];
    const normal = suggestToday({ ...base, activities: acts });
    const tired = suggestToday({ ...base, activities: acts }, { sleptBadly: true });
    const order = { suave: 0, moderada: 1, alta: 2 };
    expect(order[tired.session!.intensity!]).toBeLessThan(order[normal.session!.intensity!] + (normal.session!.intensity === "suave" ? 1 : 0));
  });
  it("adaptar a casa convierte salidas en trabajo funcional con el material", () => {
    const s = suggestToday({ ...base, activities: [act({ local_date: "2026-10-09" })] }, { sport: "emtb", location: "casa" });
    expect(s.session?.category).toBe("hiit");
    expect(s.session?.main_block).toMatch(/polea/);
  });
  it("e-MTB: la propuesta aclara que la velocidad no mide forma", () => {
    const s = buildSession("emtb", "moderada", 90, "2026-10-11", profile);
    expect(s.objective).toMatch(/asistencia/);
    expect(s.duration_min).toBe(90);
  });
  it("reorganizar la semana propone cambios, no los aplica", () => {
    const p = { id: "p1", date: "2026-10-06", status: "planificada", category: "hiit", title: "Fuerza", intensity: "alta" } as PlannedSession;
    const r = reorganizeWeek({ ...base, today: "2026-10-07", planned: [p] });
    expect(r.changes[0]?.id).toBe("p1");
    expect(p.date).toBe("2026-10-06");
  });
});
