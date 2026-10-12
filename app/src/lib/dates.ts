// Fechas de calendario como cadenas ISO "YYYY-MM-DD", operadas en UTC
// puro para que los cálculos no dependan de la zona del navegador. La
// zona horaria del usuario (Europe/Madrid por defecto) solo se usa para
// saber qué día es «hoy» y para mostrar horas.

export const DEFAULT_TZ = "Europe/Madrid";

export function todayISO(tz = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function parseISO(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const x = parseISO(d);
  x.setUTCDate(x.getUTCDate() + n);
  return toISO(x);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / 86400000);
}

/** 1 = lunes … 7 = domingo */
export function isoWeekday(d: string): number {
  const w = parseISO(d).getUTCDay();
  return w === 0 ? 7 : w;
}

export function startOfWeek(d: string): string {
  return addDays(d, 1 - isoWeekday(d));
}

export function weekDays(d: string): string[] {
  const start = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function startOfMonth(d: string): string {
  return d.slice(0, 8) + "01";
}

export function addMonths(d: string, n: number): string {
  const x = parseISO(startOfMonth(d));
  x.setUTCMonth(x.getUTCMonth() + n);
  return toISO(x);
}

/** Semanas (lunes a domingo) que cubren el mes */
export function monthWeeks(d: string): string[][] {
  const first = startOfMonth(d);
  const nextMonth = addMonths(first, 1);
  const weeks: string[][] = [];
  let cursor = startOfWeek(first);
  while (cursor < nextMonth) {
    weeks.push(weekDays(cursor));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function rangeDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const DOW = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const DOW_LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function dowShort(d: string): string {
  return DOW[isoWeekday(d) - 1];
}
export function dowLong(d: string): string {
  return DOW_LONG[isoWeekday(d) - 1];
}
export const DOW_LABELS = DOW;

export function fmtDay(d: string): string {
  const x = parseISO(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
}

export function fmtDayLong(d: string): string {
  const x = parseISO(d);
  return `${dowLong(d)}, ${x.getUTCDate()} de ${MONTHS_LONG[x.getUTCMonth()]} de ${x.getUTCFullYear()}`;
}

export function fmtMonth(d: string): string {
  const x = parseISO(d);
  return `${MONTHS_LONG[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}

export function fmtWeekRange(start: string): string {
  const end = addDays(start, 6);
  return `${fmtDay(start)} – ${fmtDay(end)}`;
}

export function fmtDateTime(iso: string | null, tz = DEFAULT_TZ): string {
  if (!iso) return "Sin datos";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtTime(iso: string | null, tz = DEFAULT_TZ): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function relativeFromNow(iso: string | null, now = new Date()): string {
  if (!iso) return "nunca";
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
