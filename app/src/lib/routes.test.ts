import { describe, expect, it } from "vitest";
import { monthlyDistance, routeActivities, routeStats } from "./routes";
import type { Activity } from "./types";

const act = (p: Partial<Activity>): Activity => ({
  id: p.id ?? "a", source: "intervals", external_id: p.id ?? "a", data_origin: "medido", start_time: null,
  local_date: p.local_date ?? "2026-09-01", name: null, source_type: null, category_auto: p.category ?? "mtb",
  category_ambiguous: false, category_override: null, category: p.category ?? "mtb", category_needs_review: false,
  duration_s: p.duration_s ?? null, moving_time_s: p.moving_time_s ?? p.duration_s ?? null, distance_m: p.distance_m ?? null,
  elevation_gain_m: p.elevation_gain_m ?? null, avg_hr: null, max_hr: null, avg_speed_ms: null, max_speed_ms: null,
  avg_cadence: null, rider_avg_power_w: null, rider_power_source: null, training_load: null, intensity: null, trimp: null,
  calories: null, hr_zone_times_s: null, hr_zone_bounds: null, device_name: null, has_gps: p.has_gps ?? false,
  has_heartrate: false, stream_types: null, api_restricted: false, last_synced_at: null,
  ...p,
});

describe("rutas: filtrado", () => {
  const acts = [
    act({ id: "1", category: "mtb", local_date: "2026-08-01" }),
    act({ id: "2", category: "emtb", local_date: "2026-09-10" }),
    act({ id: "3", category: "hiit", local_date: "2026-09-12" }),
    act({ id: "4", category: "run", local_date: "2026-09-15" }),
  ];

  it("solo incluye MTB y e-MTB, nunca otros deportes", () => {
    const r = routeActivities(acts, "todas");
    expect(r.map((a) => a.id).sort()).toEqual(["1", "2"]);
  });

  it("filtra por categoría cuando se pide", () => {
    expect(routeActivities(acts, "mtb").map((a) => a.id)).toEqual(["1"]);
    expect(routeActivities(acts, "emtb").map((a) => a.id)).toEqual(["2"]);
  });

  it("respeta el rango de fechas", () => {
    expect(routeActivities(acts, "todas", "2026-09-01").map((a) => a.id)).toEqual(["2"]);
  });

  it("ordena de más reciente a más antigua", () => {
    expect(routeActivities(acts, "todas").map((a) => a.id)).toEqual(["2", "1"]);
  });
});

describe("rutas: estadísticas", () => {
  it("suma distancia y desnivel solo de lo que trae el dato; no inventa", () => {
    const acts = [
      act({ distance_m: 20000, elevation_gain_m: 450, moving_time_s: 3600, has_gps: true }),
      act({ distance_m: 15000, elevation_gain_m: null, moving_time_s: 2700, has_gps: false }),
    ];
    const s = routeStats(acts);
    expect(s.count).toBe(2);
    expect(s.km).toBe(35);
    expect(s.elevationM).toBe(450); // solo la que tiene dato
    expect(s.timeS).toBe(6300);
    expect(s.avgSpeedMs).toBeCloseTo(35000 / 6300, 5);
    expect(s.withGps).toBe(1);
  });

  it("sin ninguna actividad con distancia, el total es null en vez de 0", () => {
    const s = routeStats([act({ distance_m: null })]);
    expect(s.km).toBeNull();
    expect(s.avgSpeedMs).toBeNull();
  });
});

describe("rutas: distancia mensual por categoría", () => {
  it("agrupa por mes y separa MTB de e-MTB, redondeado a 0,1 km", () => {
    const acts = [
      act({ category: "mtb", local_date: "2026-09-05", distance_m: 20150 }),
      act({ category: "mtb", local_date: "2026-09-20", distance_m: 10050 }),
      act({ category: "emtb", local_date: "2026-09-12", distance_m: 30000 }),
      act({ category: "mtb", local_date: "2026-10-01", distance_m: 5000 }),
    ];
    const m = monthlyDistance(acts);
    expect(m).toEqual([
      { month: "2026-09", mtb: 30.2, emtb: 30 },
      { month: "2026-10", mtb: 5, emtb: 0 },
    ]);
  });

  it("ignora actividades sin distancia o fuera de MTB/e-MTB", () => {
    const acts = [act({ category: "run", local_date: "2026-09-01", distance_m: 8000 }), act({ category: "mtb", local_date: "2026-09-01", distance_m: null })];
    expect(monthlyDistance(acts)).toEqual([]);
  });
});
