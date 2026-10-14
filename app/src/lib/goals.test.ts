import { describe, expect, it } from "vitest";
import { activityKcal, sessionsGoal, sleepAverage, weightChart, weightPlan, weightSlope } from "./goals";
import type { Activity, Measurement, Profile, Wellness } from "./types";

const m = (d: string, kg: number): Measurement => ({ id: d, source: "intervals", measured_on: d, weight_kg: kg, body_fat_pct: null, waist_cm: null, data_origin: "medido", notes: null, last_synced_at: null });
const prof = (p: Partial<Profile>): Profile => ({ user_id: "u", display_name: null, timezone: "Europe/Madrid", units: { weight: "kg", distance: "km", elevation: "m" }, theme: "dark", goals: null, weight_goal_kg: null, hr_max_bpm: null, available_days: [], session_minutes_default: null, sport_priority: [], equipment: [], limitations: null, preferences: null, ...p });
const act = (d: string, kcal: number | null): Activity => ({ id: d + kcal, local_date: d, calories: kcal } as Activity);

describe("objetivo de peso", () => {
  const meas = [m("2026-09-15", 81.5), m("2026-09-22", 81.0), m("2026-09-29", 80.6), m("2026-10-12", 80.1)];

  it("sin objetivo no hay plan", () => {
    expect(weightPlan(prof({}), meas, "2026-10-13")).toBeNull();
  });

  it("80,1 → 76 kg el 13/04/2027: ritmo y déficit diario necesarios", () => {
    const p = weightPlan(prof({ weight_goal_kg: 76, weight_goal_date: "2027-04-13" }), meas, "2026-10-13")!;
    expect(p.remaining).toBeCloseTo(4.1, 5);
    expect(p.daysLeft).toBe(182);
    expect(p.neededKgWeek).toBeCloseTo(-0.158, 2);
    expect(Math.round(p.dailyKcal!)).toBe(173); // 4,1 × 7700 / 182
  });

  it("el ritmo real sale de las mediciones y proyecta una fecha si va hacia el objetivo", () => {
    const slope = weightSlope(meas, "2026-10-13")!;
    expect(slope).toBeLessThan(0);
    const p = weightPlan(prof({ weight_goal_kg: 76 }), meas, "2026-10-13")!;
    expect(p.goalDate).toBeNull();
    expect(p.dailyKcal).toBeNull();
    expect(p.actualKgWeek).toBeLessThan(0);
    expect(p.projectedDate! > "2026-10-13").toBe(true);
    expect(p.progress).toBeGreaterThan(0);
  });

  it("si el peso sube no se inventa una fecha de llegada", () => {
    const up = [m("2026-09-20", 79), m("2026-09-30", 79.6), m("2026-10-12", 80.1)];
    expect(weightPlan(prof({ weight_goal_kg: 76 }), up, "2026-10-13")!.projectedDate).toBeNull();
  });

  it("con pocas mediciones no hay ritmo real", () => {
    expect(weightSlope([m("2026-10-01", 80), m("2026-10-12", 79.5)], "2026-10-13")).toBeNull();
  });

  it("la gráfica es semanal y la trayectoria termina en el objetivo", () => {
    const p = weightPlan(prof({ weight_goal_kg: 76, weight_goal_date: "2027-04-13" }), meas, "2026-10-13")!;
    const pts = weightChart(meas, "2026-10-13", p);
    expect(pts.every((x, i) => i === 0 || x.x > pts[i - 1].x)).toBe(true);
    expect(pts[pts.length - 1].plan).toBeCloseTo(76, 0);
    expect(pts.filter((x) => x.peso !== null).length).toBe(4);
  });
});

describe("calorías, sesiones y sueño", () => {
  it("suma las kcal del día y avisa de actividades sin dato", () => {
    expect(activityKcal([act("2026-10-13", 520), act("2026-10-13", null), act("2026-10-12", 300)], "2026-10-13"))
      .toEqual({ kcal: 520, missing: 1, count: 2 });
    expect(activityKcal([], "2026-10-13").kcal).toBeNull();
  });

  it("la meta de sesiones usa la fijada o los días disponibles, nunca un número inventado", () => {
    expect(sessionsGoal(prof({ sessions_week_goal: 4 }))).toEqual({ value: 4, fromProfileDays: false });
    expect(sessionsGoal(prof({ available_days: [1, 3, 5] }))).toEqual({ value: 3, fromProfileDays: true });
    expect(sessionsGoal(prof({})).value).toBeNull();
  });

  it("media de sueño de los últimos 7 días con dato", () => {
    const w = (d: string, h: number | null) => ({ date: d, sleep_secs: h === null ? null : h * 3600 } as Wellness);
    const s = sleepAverage([w("2026-10-13", 7), w("2026-10-12", 6), w("2026-10-11", null), w("2026-10-01", 9)], "2026-10-13");
    expect(s.hours).toBe(6.5);
    expect(s.n).toBe(2);
  });
});
