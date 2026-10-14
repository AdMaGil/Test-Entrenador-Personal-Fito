// Importación del export de Feelfit (Excel).
//
// Reglas:
//   * Solo se lee la hoja de mediciones de peso. Las demás se ignoran.
//   * 0 o vacío = sin dato (NULL), nunca 0. Las columnas por segmento
//     (muslos, tronco) no se importan: en la báscula actual siempre son 0.
//   * Mediciones repetidas (misma fecha y hora) se importan una vez.
//   * Pesadas atípicas (≥ 5 kg respecto a la mediana de sus vecinas, p. ej.
//     otra persona en la báscula) quedan EXCLUIDAS por defecto; se listan
//     para que decidas.
//   * Reimportar no duplica: external_id = «feelfit:<fecha y hora>».
//   * La composición (todo salvo el peso) son estimaciones de la báscula.
import type { Cell, Sheet } from "./xlsx";
import type { Measurement } from "./types";

export const OUTLIER_KG = 5;

/** Columnas reconocidas: cabecera (español o inglés) → campo. */
const COLUMNS: { field: keyof FeelfitMetrics | "time"; headers: string[]; int?: boolean }[] = [
  { field: "time", headers: ["tiempo de medición", "measurement time", "time"] },
  { field: "weight_kg", headers: ["peso(kg)", "weight(kg)"] },
  { field: "body_fat_pct", headers: ["grasa corporal(%)", "body fat(%)"] },
  { field: "bmi", headers: ["bmi", "imc"] },
  { field: "skeletal_muscle_pct", headers: ["músculo esquelético(%)", "skeletal muscle(%)"] },
  { field: "muscle_mass_kg", headers: ["masa muscular(kg)", "muscle mass(kg)"] },
  { field: "protein_pct", headers: ["proteína(%)", "protein(%)"] },
  { field: "bmr_kcal", headers: ["bmr(kcal)"], int: true },
  { field: "fat_free_mass_kg", headers: ["peso libre de grasa(kg)", "fat-free body weight(kg)", "fat free mass(kg)"] },
  { field: "subcutaneous_fat_pct", headers: ["porcentaje de grasa subcutánea(%)", "subcutaneous fat(%)"] },
  { field: "visceral_fat", headers: ["grasa visceral", "visceral fat"] },
  { field: "body_water_pct", headers: ["agua corporal(%)", "body water(%)"] },
  { field: "bone_mass_kg", headers: ["masa ósea(kg)", "bone mass(kg)"] },
  { field: "metabolic_age", headers: ["edad metabólica", "metabolic age"], int: true },
];

export interface FeelfitMetrics {
  weight_kg: number;
  body_fat_pct: number | null;
  bmi: number | null;
  skeletal_muscle_pct: number | null;
  muscle_mass_kg: number | null;
  protein_pct: number | null;
  bmr_kcal: number | null;
  fat_free_mass_kg: number | null;
  subcutaneous_fat_pct: number | null;
  visceral_fat: number | null;
  body_water_pct: number | null;
  bone_mass_kg: number | null;
  metabolic_age: number | null;
}

export interface FeelfitRow extends FeelfitMetrics {
  /** Fecha y hora local tal como viene en el export («AAAA-MM-DD HH:MM:SS»). */
  local_time: string;
  measured_on: string;
  external_id: string;
}

export interface FeelfitParse {
  rows: FeelfitRow[];
  duplicatesInFile: number;
  invalid: { line: number; reason: string }[];
  outliers: { row: FeelfitRow; neighborsMedianKg: number }[];
  /** Columnas del export que no se importan (por segmento, puntuación, tipo corporal…). */
  ignoredColumns: string[];
}

const norm = (s: Cell) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function num(v: Cell, int = false): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return int ? Math.round(n) : Math.round(n * 100) / 100;
}

function parseLocalTime(v: Cell): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] ?? "00"}`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function findMeasurementSheet(sheets: Sheet[]): Sheet | null {
  return sheets.find((s) => s.rows[0]?.some((h) => ["peso(kg)", "weight(kg)"].includes(norm(h)))) ?? null;
}

export function parseFeelfit(sheets: Sheet[]): FeelfitParse {
  const sheet = findMeasurementSheet(sheets);
  if (!sheet) throw new Error("No se encuentra la hoja de mediciones de peso. ¿Es el export de Feelfit?");
  const header = sheet.rows[0].map(norm);
  const idx = new Map<string, number>();
  for (const c of COLUMNS) {
    const i = header.findIndex((h) => c.headers.includes(h));
    if (i >= 0) idx.set(c.field, i);
  }
  if (!idx.has("time") || !idx.has("weight_kg")) throw new Error("Faltan las columnas de fecha o de peso en el export.");
  const used = new Set(idx.values());
  const ignoredColumns = [...new Set(sheet.rows[0].filter((_, i) => !used.has(i)).map((h) => String(h ?? "").trim()).filter(Boolean))];

  const seen = new Set<string>();
  const rows: FeelfitRow[] = [];
  const invalid: FeelfitParse["invalid"] = [];
  let duplicatesInFile = 0;
  sheet.rows.slice(1).forEach((r, i) => {
    if (r.every((c) => c === null || c === "")) return;
    const time = parseLocalTime(r[idx.get("time") as number]);
    const weight = num(r[idx.get("weight_kg") as number]);
    if (!time) { invalid.push({ line: i + 2, reason: "Fecha y hora no reconocidas" }); return; }
    if (weight === null || weight < 20 || weight > 300) { invalid.push({ line: i + 2, reason: "Peso ausente o fuera de rango" }); return; }
    if (seen.has(time)) { duplicatesInFile++; return; }
    seen.add(time);
    const get = (f: keyof FeelfitMetrics, int?: boolean) => (idx.has(f) ? num(r[idx.get(f) as number], int) : null);
    const row: FeelfitRow = {
      local_time: time, measured_on: time.slice(0, 10), external_id: `feelfit:${time}`,
      weight_kg: weight,
      body_fat_pct: get("body_fat_pct"), bmi: get("bmi"), skeletal_muscle_pct: get("skeletal_muscle_pct"),
      muscle_mass_kg: get("muscle_mass_kg"), protein_pct: get("protein_pct"), bmr_kcal: get("bmr_kcal", true),
      fat_free_mass_kg: get("fat_free_mass_kg"), subcutaneous_fat_pct: get("subcutaneous_fat_pct"),
      visceral_fat: get("visceral_fat"), body_water_pct: get("body_water_pct"), bone_mass_kg: get("bone_mass_kg"),
      metabolic_age: get("metabolic_age", true),
    };
    // Rangos imposibles se descartan campo a campo (sin inventar)
    if (row.body_fat_pct !== null && (row.body_fat_pct < 2 || row.body_fat_pct > 70)) row.body_fat_pct = null;
    rows.push(row);
  });
  rows.sort((a, b) => a.local_time.localeCompare(b.local_time));

  const outliers: FeelfitParse["outliers"] = [];
  rows.forEach((r, i) => {
    const nb = [...rows.slice(Math.max(0, i - 5), i), ...rows.slice(i + 1, i + 6)].map((x) => x.weight_kg);
    if (nb.length < 3) return;
    const m = median(nb);
    if (Math.abs(r.weight_kg - m) >= OUTLIER_KG) outliers.push({ row: r, neighborsMedianKg: Math.round(m * 10) / 10 });
  });
  return { rows, duplicatesInFile, invalid, outliers, ignoredColumns };
}

/** Convierte una hora local («AAAA-MM-DD HH:MM:SS») de una zona horaria a ISO UTC. */
export function localToUtcIso(local: string, tz: string): string {
  const [d, t] = local.split(" ");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi, s] = t.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi, s);
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(ms));
    const v = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - ms;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms);
  return new Date(ms).toISOString();
}

export interface ImportPlan {
  toInsert: FeelfitRow[];
  alreadyImported: number;
  excludedOutliers: FeelfitRow[];
  /** Días en que una pesada de Intervals coincide (±0,1 kg) con Feelfit: se unifican. */
  unifiedWithIntervals: number;
  from: string | null;
  to: string | null;
}

/** Plan de importación frente a lo que ya hay guardado. `includeOutliers` = external_id de atípicos que decides incluir. */
export function planImport(parse: FeelfitParse, existing: Measurement[], includeOutliers: Set<string> = new Set()): ImportPlan {
  const have = new Set(existing.filter((m) => m.source === "feelfit").map((m) => m.external_id ?? ""));
  const outlierIds = new Set(parse.outliers.map((o) => o.row.external_id).filter((id) => !includeOutliers.has(id)));
  const candidates = parse.rows.filter((r) => !outlierIds.has(r.external_id));
  const toInsert = candidates.filter((r) => !have.has(r.external_id));
  const all = [...candidates];
  const unified = existing.filter((m) => m.source === "intervals" && m.weight_kg !== null
    && all.some((r) => r.measured_on === m.measured_on && Math.abs(r.weight_kg - (m.weight_kg as number)) <= 0.1 + 1e-9)).length;
  return {
    toInsert,
    alreadyImported: candidates.length - toInsert.length,
    excludedOutliers: parse.rows.filter((r) => outlierIds.has(r.external_id)),
    unifiedWithIntervals: unified,
    from: candidates[0]?.measured_on ?? null,
    to: candidates[candidates.length - 1]?.measured_on ?? null,
  };
}

/** Fila lista para guardar. */
export function toMeasurementInsert(r: FeelfitRow, tz: string) {
  const { local_time, ...rest } = r;
  return { ...rest, source: "feelfit" as const, measured_at: localToUtcIso(local_time, tz), data_origin: "medido" as const, notes: null, waist_cm: null };
}
