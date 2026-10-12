import type { Units } from "./types";

// Regla: un dato ausente se muestra como «Sin datos», nunca como cero.
export const MISSING = "Sin datos";

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const nf = (digits: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function fmtNum(v: number | null | undefined, digits = 0): string {
  return isNum(v) ? nf(digits).format(v) : MISSING;
}

export function fmtDuration(seconds: number | null | undefined, opts: { short?: boolean } = {}): string {
  if (!isNum(seconds)) return MISSING;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (opts.short) {
    if (h === 0) return `${m} min`;
    return `${h} h ${String(m).padStart(2, "0")} min`;
  }
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtDistance(m: number | null | undefined, units: Units): string {
  if (!isNum(m)) return MISSING;
  if (units.distance === "mi") return `${fmtNum(m / 1609.344, 1)} mi`;
  return `${fmtNum(m / 1000, m < 10000 ? 2 : 1)} km`;
}

export function fmtElevation(m: number | null | undefined, units: Units): string {
  if (!isNum(m)) return MISSING;
  if (units.elevation === "ft") return `${fmtNum(m * 3.28084)} ft`;
  return `${fmtNum(m)} m`;
}

export function fmtWeight(kg: number | null | undefined, units: Units, digits = 1): string {
  if (!isNum(kg)) return MISSING;
  if (units.weight === "lb") return `${fmtNum(kg * 2.20462, digits)} lb`;
  return `${fmtNum(kg, digits)} kg`;
}

export function fmtSpeed(ms: number | null | undefined, units: Units): string {
  if (!isNum(ms)) return MISSING;
  return units.distance === "mi" ? `${fmtNum(ms * 2.23694, 1)} mi/h` : `${fmtNum(ms * 3.6, 1)} km/h`;
}

/** Ritmo de carrera: min/km o min/mi */
export function fmtPace(ms: number | null | undefined, units: Units): string {
  if (!isNum(ms) || ms <= 0) return MISSING;
  const perUnit = units.distance === "mi" ? 1609.344 / ms : 1000 / ms;
  return `${fmtClock(perUnit)} /${units.distance}`;
}

export function fmtHr(v: number | null | undefined): string {
  return isNum(v) ? `${Math.round(v)} ppm` : MISSING;
}

export function fmtSigned(v: number | null | undefined, digits = 0, unit = ""): string {
  if (!isNum(v)) return MISSING;
  const s = fmtNum(Math.abs(v), digits);
  const sign = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sign}${s}${unit}`;
}

export function pctChange(curr: number, prev: number): number | null {
  if (!isNum(curr) || !isNum(prev) || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

export function sum(values: (number | null | undefined)[]): number {
  return values.reduce<number>((acc, v) => acc + (isNum(v) ? v : 0), 0);
}

export function mean(values: (number | null | undefined)[]): number | null {
  const v = values.filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}
