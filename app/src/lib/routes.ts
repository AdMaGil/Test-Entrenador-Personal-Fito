// Rutas: solo MTB y e-MTB. Reutiliza los datos ya sincronizados (categoría y
// streams GPS vienen de Intervals.icu o de la importación manual de
// FIT/GPX/TCX); no inventa ni reclasifica nada.
import { startOfMonth } from "./dates";
import { isNum } from "./format";
import type { Activity } from "./types";

export type RouteCategory = "mtb" | "emtb";
export const ROUTE_CATEGORIES: RouteCategory[] = ["emtb", "mtb"];

export function isRoute(a: Activity): a is Activity & { category: RouteCategory } {
  return a.category === "mtb" || a.category === "emtb";
}

export function routeActivities(acts: Activity[], filter: RouteCategory | "todas", from?: string, to?: string): Activity[] {
  return acts
    .filter(isRoute)
    .filter((a) => filter === "todas" || a.category === filter)
    .filter((a) => (!from || a.local_date >= from) && (!to || a.local_date <= to))
    .sort((a, b) => b.local_date.localeCompare(a.local_date) || (b.start_time ?? "").localeCompare(a.start_time ?? ""));
}

export interface RouteStats {
  count: number;
  km: number | null;
  elevationM: number | null;
  timeS: number;
  avgSpeedMs: number | null;
  withGps: number;
}

export function routeStats(acts: Activity[]): RouteStats {
  const dist = acts.map((a) => a.distance_m).filter(isNum);
  const elev = acts.map((a) => a.elevation_gain_m).filter(isNum);
  const timeS = acts.reduce((s, a) => s + (a.moving_time_s ?? a.duration_s ?? 0), 0);
  const totalDist = dist.length ? dist.reduce((s, v) => s + v, 0) : null;
  return {
    count: acts.length,
    km: totalDist !== null ? totalDist / 1000 : null,
    elevationM: elev.length ? elev.reduce((s, v) => s + v, 0) : null,
    timeS,
    avgSpeedMs: totalDist !== null && timeS ? totalDist / timeS : null,
    withGps: acts.filter((a) => a.has_gps).length,
  };
}

export interface MonthlyRoutePoint {
  month: string;
  mtb: number;
  emtb: number;
}

/** km por mes y categoría, para comparar MTB frente a e-MTB a lo largo del tiempo. */
export function monthlyDistance(acts: Activity[]): MonthlyRoutePoint[] {
  const byMonth = new Map<string, { mtb: number; emtb: number }>();
  for (const a of acts) {
    if (!isRoute(a) || !isNum(a.distance_m)) continue;
    const m = startOfMonth(a.local_date).slice(0, 7);
    const row = byMonth.get(m) ?? { mtb: 0, emtb: 0 };
    row[a.category as RouteCategory] += a.distance_m / 1000;
    byMonth.set(m, row);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, mtb: Math.round(v.mtb * 10) / 10, emtb: Math.round(v.emtb * 10) / 10 }));
}


