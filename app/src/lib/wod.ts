// =====================================================================
// Formato de intercambio de WOD «adolfo-wod» v1 y su lectura determinista.
//
// El WOD llega como texto pegado (normalmente un bloque JSON generado por
// ChatGPT a partir de capturas). Todo su contenido se trata como DATOS:
// se valida campo a campo, nunca se ejecuta ni se interpreta como HTML, y
// lo que no se reconoce se conserva en `no_reconocido` para revisarlo.
//
// Reglas:
//   * Desconocido = null, nunca 0. Un 0 en un campo donde no tiene sentido
//     (kilos, rondas, objetivo…) se convierte en null con un aviso.
//   * Una indicación temporal de significado no confirmado va en
//     `indicacion_tiempo` (texto), no en `limite_tiempo_s`.
//   * Las alternativas se conservan sin decidir cuál corresponde.
// Documentación completa y prompt para ChatGPT: docs/wod-formato.md
// =====================================================================

export const WOD_FORMAT = "adolfo-wod";
export const WOD_VERSION = 1;

export type WodBlockType = "emom" | "amrap" | "for_time" | "rondas" | "descanso" | "otro";
export type WodTargetType = "reps" | "segundos" | "metros" | "calorias" | "max_reps" | "max_calorias" | "otro";
export type WodModality = "individual" | "parejas";
export type WodLoadMode = "total" | "por_implemento";

export interface WodTarget {
  tipo: WodTargetType | null;
  valor: number | null;
  por_ronda: number[] | null;
  alternativas: string[] | null;
  por_lado: boolean | null;
  texto: string | null;
}

export interface WodLoad {
  texto: string | null;
  kg: number | null;
  implementos: number | null;
  modo: WodLoadMode | null;
}

export interface WodItem {
  id: string;
  nombre: string;
  /** Etiqueta del WOD («A», «B», «1»…): puede ser una estación o un ejercicio. No indica personas ni reparto del trabajo. */
  etiqueta: string | null;
  objetivo: WodTarget | null;
  carga: WodLoad | null;
  equipamiento: string | null;
  alternativas: string[] | null;
  /** La pizarra pide repetir la carga anterior («LAST WEEK»): se destaca «Última vez». */
  repetir_carga_anterior: boolean | null;
  notas: string | null;
}

export interface WodRpe {
  desde_ronda: number | null;
  hasta_ronda: number | null;
  valor: number;
}

export interface WodRest {
  duracion_s: number | null;
  ubicacion: "entre_rondas" | "tras_bloque" | null;
  texto: string | null;
}

export interface WodBlock {
  id: string;
  titulo: string | null;
  tipo: WodBlockType;
  duracion_s: number | null;
  limite_tiempo_s: number | null;
  indicacion_tiempo: string | null;
  rondas: number | null;
  intervalo_s: number | null;
  rpe: WodRpe[] | null;
  descanso: WodRest | null;
  ejercicios: WodItem[];
  notas: string | null;
}

export interface WodWarmup {
  rondas: number | null;
  ejercicios: WodItem[];
  notas: string | null;
}

export interface WodUnrecognized {
  ruta: string;
  valor: string;
}

export interface WodSpec {
  formato: typeof WOD_FORMAT;
  version: typeof WOD_VERSION;
  nombre: string | null;
  /** Fecha completa AAAA-MM-DD solo si es segura; si falta el año queda null. */
  fecha: string | null;
  /** Fecha tal como se ve en la captura («12/10», «lunes 12»), sin completar. */
  fecha_texto: string | null;
  modalidad: WodModality | null;
  transcripcion: string | null;
  calentamiento: WodWarmup | null;
  bloques: WodBlock[];
  resumen_enfoque: string | null;
  notas: string | null;
  ambiguedades: string[];
  /** Añadido por la app: claves o valores que no encajan en el formato, conservados para revisión. */
  no_reconocido: WodUnrecognized[];
}

/** Fila del formato sencillo antiguo «Ejercicio | Serie | Reps | Peso(kg)». */
export interface LegacyRow {
  exercise: string;
  set_number: number;
  reps: number | null;
  weight_kg: number | null;
  /** El peso venía marcado como «revisar» (o equivalente): queda pendiente. */
  pending: boolean;
}

export type WodParseResult =
  | { kind: "wod"; wod: WodSpec; warnings: string[] }
  | { kind: "legacy"; rows: LegacyRow[]; unrecognized: string[]; warnings: string[] }
  | { kind: "error"; errors: string[] };

// ---------------------------------------------------------------------
// Límites defensivos
// ---------------------------------------------------------------------
const MAX_INPUT_CHARS = 120_000;
const MAX_BLOCKS = 40;
const MAX_ITEMS = 80;
const MAX_TEXT = 4_000;
const MAX_TRANSCRIPTION = 30_000;

// ---------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------
export const BLOCK_TYPE_LABEL: Record<WodBlockType, string> = {
  emom: "EMOM", amrap: "AMRAP", for_time: "For Time", rondas: "Rondas", descanso: "Descanso", otro: "Bloque",
};

const BLOCK_TYPE_ALIASES: Record<string, WodBlockType> = {
  emom: "emom", e2mom: "emom", e3mom: "emom", "every minute on the minute": "emom",
  amrap: "amrap",
  for_time: "for_time", "for time": "for_time", fortime: "for_time", "por tiempo": "for_time", ft: "for_time",
  rondas: "rondas", rounds: "rondas", ronda: "rondas", round: "rondas",
  descanso: "descanso", rest: "descanso", recuperacion: "descanso", "recuperación": "descanso",
  otro: "otro", other: "otro",
};

const TARGET_TYPE_ALIASES: Record<string, WodTargetType> = {
  reps: "reps", repeticiones: "reps", rep: "reps",
  segundos: "segundos", seg: "segundos", s: "segundos", tiempo: "segundos", seconds: "segundos",
  metros: "metros", m: "metros", meters: "metros", distancia: "metros",
  calorias: "calorias", "calorías": "calorias", cal: "calorias", calories: "calorias",
  max_reps: "max_reps", "max reps": "max_reps", maximas_repeticiones: "max_reps",
  max_calorias: "max_calorias", "max calorias": "max_calorias", "max cal": "max_calorias", max_cal: "max_calorias",
  otro: "otro",
};

// ---------------------------------------------------------------------
// Utilidades de lectura
// ---------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

class Ctx {
  warnings: string[] = [];
  unrecognized: WodUnrecognized[] = [];
  keep(ruta: string, valor: unknown) {
    let s: string;
    try { s = typeof valor === "string" ? valor : JSON.stringify(valor); } catch { s = String(valor); }
    this.unrecognized.push({ ruta, valor: s.length > 500 ? `${s.slice(0, 500)}…` : s });
  }
  /** Registra las claves que el formato no contempla. */
  extraKeys(o: Obj, allowed: readonly string[], ruta: string) {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) this.keep(`${ruta}.${k}`, o[k]);
  }
}

function str(v: unknown, ruta: string, ctx: Ctx, max = MAX_TEXT): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") { ctx.keep(ruta, v); return null; }
  const t = v.replace(/\u0000/g, "").trim();
  if (!t) return null;
  if (t.length > max) { ctx.warnings.push(`El texto de «${ruta}» se ha recortado a ${max} caracteres.`); return t.slice(0, max); }
  return t;
}

function parseNumberish(v: unknown): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : "invalid";
  if (typeof v === "string") {
    const t = v.trim().replace(",", ".");
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  }
  return "invalid";
}

/**
 * Número positivo. Un 0 se trata como desconocido (nunca como valor real)
 * y se avisa; un valor no numérico se conserva para revisión.
 */
function pos(v: unknown, ruta: string, ctx: Ctx, opts: { int?: boolean; max?: number } = {}): number | null {
  const n = parseNumberish(v);
  if (n === null) return null;
  if (n === "invalid" || n < 0 || (opts.max !== undefined && n > opts.max)) { ctx.keep(ruta, v); return null; }
  if (n === 0) { ctx.warnings.push(`«${ruta}» venía como 0; se trata como dato desconocido.`); return null; }
  if (opts.int && !Number.isInteger(n)) { ctx.keep(ruta, v); return null; }
  return n;
}

function strList(v: unknown, ruta: string, ctx: Ctx): string[] | null {
  if (v === null || v === undefined) return null;
  const arr = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  arr.forEach((x, i) => { const s = str(x, `${ruta}[${i}]`, ctx); if (s) out.push(s); });
  return out.length ? out : null;
}

function bool(v: unknown, ruta: string, ctx: Ctx): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  ctx.keep(ruta, v);
  return null;
}

function normKey(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s-]+/g, " ").trim();
}

function enumOf<T extends string>(v: unknown, aliases: Record<string, T>, ruta: string, ctx: Ctx): T | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") { ctx.keep(ruta, v); return null; }
  const k = normKey(v);
  const hit = aliases[k] ?? aliases[k.replace(/ /g, "_")];
  if (!hit) { ctx.keep(ruta, v); return null; }
  return hit;
}

// ---------------------------------------------------------------------
// Lectura de cada parte del WOD
// ---------------------------------------------------------------------
const TARGET_KEYS = ["tipo", "valor", "por_ronda", "alternativas", "por_lado", "texto"] as const;
function readTarget(v: unknown, ruta: string, ctx: Ctx): WodTarget | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") {
    // Atajo tolerado: un número o texto suelto se guarda como texto literal sin interpretarlo.
    return { tipo: null, valor: null, por_ronda: null, alternativas: null, por_lado: null, texto: String(v) };
  }
  if (!isObj(v)) { ctx.keep(ruta, v); return null; }
  ctx.extraKeys(v, TARGET_KEYS, ruta);
  let porRonda: number[] | null = null;
  if (Array.isArray(v.por_ronda)) {
    const nums = v.por_ronda.map((x, i) => pos(x, `${ruta}.por_ronda[${i}]`, ctx, { max: 100000 }));
    porRonda = nums.every((x) => x !== null) && nums.length ? (nums as number[]) : null;
    if (!porRonda && nums.length) ctx.keep(`${ruta}.por_ronda`, v.por_ronda);
  } else if (v.por_ronda !== undefined && v.por_ronda !== null) ctx.keep(`${ruta}.por_ronda`, v.por_ronda);
  const t: WodTarget = {
    tipo: enumOf(v.tipo, TARGET_TYPE_ALIASES, `${ruta}.tipo`, ctx),
    valor: pos(v.valor, `${ruta}.valor`, ctx, { max: 100000 }),
    por_ronda: porRonda,
    alternativas: strList(v.alternativas, `${ruta}.alternativas`, ctx),
    por_lado: bool(v.por_lado, `${ruta}.por_lado`, ctx),
    texto: str(v.texto, `${ruta}.texto`, ctx, 300),
  };
  return Object.values(t).every((x) => x === null) ? null : t;
}

const LOAD_KEYS = ["texto", "kg", "implementos", "modo"] as const;
function readLoad(v: unknown, ruta: string, ctx: Ctx): WodLoad | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number") {
    return { texto: String(v), kg: null, implementos: null, modo: null };
  }
  if (!isObj(v)) { ctx.keep(ruta, v); return null; }
  ctx.extraKeys(v, LOAD_KEYS, ruta);
  const modo = enumOf<WodLoadMode>(v.modo, { total: "total", por_implemento: "por_implemento", "por implemento": "por_implemento" }, `${ruta}.modo`, ctx);
  const l: WodLoad = {
    texto: str(v.texto, `${ruta}.texto`, ctx, 300),
    kg: pos(v.kg, `${ruta}.kg`, ctx, { max: 500 }),
    implementos: pos(v.implementos, `${ruta}.implementos`, ctx, { int: true, max: 20 }),
    modo,
  };
  return Object.values(l).every((x) => x === null) ? null : l;
}

// «participante» se acepta como nombre antiguo de «etiqueta»
const ITEM_KEYS = ["id", "nombre", "etiqueta", "participante", "objetivo", "carga", "equipamiento", "alternativas", "repetir_carga_anterior", "notas"] as const;
function readItems(v: unknown, ruta: string, ctx: Ctx, ids: Set<string>, prefix: string): WodItem[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) { ctx.keep(ruta, v); return []; }
  if (v.length > MAX_ITEMS) ctx.warnings.push(`«${ruta}» tiene más de ${MAX_ITEMS} ejercicios; se han leído los ${MAX_ITEMS} primeros.`);
  const out: WodItem[] = [];
  v.slice(0, MAX_ITEMS).forEach((raw, i) => {
    const r = `${ruta}[${i}]`;
    if (typeof raw === "string") {
      // Un ejercicio dado solo como texto: se conserva tal cual, sin interpretar objetivo ni carga.
      out.push({ id: uniqueId(null, ids, prefix), nombre: raw.trim().slice(0, 200) || "Ejercicio sin nombre", etiqueta: null,
        objetivo: null, carga: null, equipamiento: null, alternativas: null, repetir_carga_anterior: null, notas: null });
      return;
    }
    if (!isObj(raw)) { ctx.keep(r, raw); return; }
    ctx.extraKeys(raw, ITEM_KEYS, r);
    const nombre = str(raw.nombre, `${r}.nombre`, ctx, 200);
    if (!nombre) ctx.warnings.push(`El ejercicio ${r} no tiene nombre.`);
    out.push({
      id: uniqueId(raw.id, ids, prefix),
      nombre: nombre ?? "Ejercicio sin nombre",
      etiqueta: str(raw.etiqueta ?? raw.participante, `${r}.etiqueta`, ctx, 40),
      objetivo: readTarget(raw.objetivo, `${r}.objetivo`, ctx),
      carga: readLoad(raw.carga, `${r}.carga`, ctx),
      equipamiento: str(raw.equipamiento, `${r}.equipamiento`, ctx, 200),
      alternativas: strList(raw.alternativas, `${r}.alternativas`, ctx),
      repetir_carga_anterior: bool(raw.repetir_carga_anterior, `${r}.repetir_carga_anterior`, ctx),
      notas: str(raw.notas, `${r}.notas`, ctx),
    });
  });
  return out;
}

function uniqueId(v: unknown, ids: Set<string>, prefix: string): string {
  let id = typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : "";
  if (!id || ids.has(id)) {
    let n = ids.size + 1;
    while (ids.has(`${prefix}${n}`)) n++;
    id = `${prefix}${n}`;
  }
  ids.add(id);
  return id;
}

const RPE_KEYS = ["desde_ronda", "hasta_ronda", "valor"] as const;
function readRpe(v: unknown, ruta: string, ctx: Ctx): WodRpe[] | null {
  if (v === null || v === undefined) return null;
  const arr = Array.isArray(v) ? v : [v];
  const out: WodRpe[] = [];
  arr.forEach((x, i) => {
    const r = `${ruta}[${i}]`;
    if (typeof x === "number") {
      if (x >= 1 && x <= 10) out.push({ desde_ronda: null, hasta_ronda: null, valor: x });
      else ctx.keep(r, x);
      return;
    }
    if (!isObj(x)) { ctx.keep(r, x); return; }
    ctx.extraKeys(x, RPE_KEYS, r);
    const valor = parseNumberish(x.valor);
    if (typeof valor !== "number" || valor < 1 || valor > 10) { ctx.keep(`${r}.valor`, x.valor); return; }
    out.push({
      desde_ronda: pos(x.desde_ronda, `${r}.desde_ronda`, ctx, { int: true, max: 1000 }),
      hasta_ronda: pos(x.hasta_ronda, `${r}.hasta_ronda`, ctx, { int: true, max: 1000 }),
      valor,
    });
  });
  return out.length ? out : null;
}

const REST_KEYS = ["duracion_s", "ubicacion", "texto"] as const;
function readRest(v: unknown, ruta: string, ctx: Ctx): WodRest | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return { duracion_s: null, ubicacion: null, texto: v.trim().slice(0, 300) || null };
  if (!isObj(v)) { ctx.keep(ruta, v); return null; }
  ctx.extraKeys(v, REST_KEYS, ruta);
  const rest: WodRest = {
    duracion_s: pos(v.duracion_s, `${ruta}.duracion_s`, ctx, { max: 36000 }),
    ubicacion: enumOf<"entre_rondas" | "tras_bloque">(v.ubicacion,
      { entre_rondas: "entre_rondas", "entre rondas": "entre_rondas", tras_bloque: "tras_bloque", "tras bloque": "tras_bloque", "al final": "tras_bloque" },
      `${ruta}.ubicacion`, ctx),
    texto: str(v.texto, `${ruta}.texto`, ctx, 300),
  };
  return Object.values(rest).every((x) => x === null) ? null : rest;
}

const BLOCK_KEYS = ["id", "titulo", "tipo", "duracion_s", "limite_tiempo_s", "indicacion_tiempo", "rondas", "intervalo_s",
  "rpe", "descanso", "ejercicios", "notas"] as const;
function readBlock(raw: Obj, ruta: string, ctx: Ctx, blockIds: Set<string>, itemIds: Set<string>): WodBlock {
  ctx.extraKeys(raw, BLOCK_KEYS, ruta);
  let tipo = enumOf(raw.tipo, BLOCK_TYPE_ALIASES, `${ruta}.tipo`, ctx);
  if (!tipo) {
    if (raw.tipo !== undefined && raw.tipo !== null) ctx.warnings.push(`Tipo de bloque no reconocido en ${ruta}: se muestra como «Bloque» y el valor original queda para revisión.`);
    tipo = "otro";
  }
  return {
    id: uniqueId(raw.id, blockIds, "b"),
    titulo: str(raw.titulo, `${ruta}.titulo`, ctx, 200),
    tipo,
    duracion_s: pos(raw.duracion_s, `${ruta}.duracion_s`, ctx, { max: 36000 }),
    limite_tiempo_s: pos(raw.limite_tiempo_s, `${ruta}.limite_tiempo_s`, ctx, { max: 36000 }),
    indicacion_tiempo: str(raw.indicacion_tiempo, `${ruta}.indicacion_tiempo`, ctx, 200),
    rondas: pos(raw.rondas, `${ruta}.rondas`, ctx, { int: true, max: 1000 }),
    intervalo_s: pos(raw.intervalo_s, `${ruta}.intervalo_s`, ctx, { max: 3600 }),
    rpe: readRpe(raw.rpe, `${ruta}.rpe`, ctx),
    descanso: readRest(raw.descanso, `${ruta}.descanso`, ctx),
    ejercicios: readItems(raw.ejercicios, `${ruta}.ejercicios`, ctx, itemIds, "e"),
    notas: str(raw.notas, `${ruta}.notas`, ctx),
  };
}

const ROOT_KEYS = ["formato", "version", "nombre", "fecha", "fecha_texto", "modalidad", "transcripcion", "calentamiento", "bloques",
  "resumen_enfoque", "notas", "ambiguedades", "no_reconocido"] as const;

/** Valida un objeto ya parseado como WOD v1. */
export function validateWod(input: unknown): { ok: true; wod: WodSpec; warnings: string[] } | { ok: false; errors: string[] } {
  if (Array.isArray(input)) {
    return { ok: false, errors: [`Has pegado ${input.length} WOD en una lista. Cada importación es un único WOD: pídele a ChatGPT uno por bloque e impórtalos por separado.`] };
  }
  if (!isObj(input)) return { ok: false, errors: ["El JSON debe ser un objeto con los datos del WOD ({ … }), no un valor suelto."] };
  const ctx = new Ctx();
  const errors: string[] = [];

  if (input.formato !== undefined && input.formato !== WOD_FORMAT) {
    errors.push(`El campo «formato» es «${String(input.formato)}»; se esperaba «${WOD_FORMAT}».`);
  }
  if (input.version !== undefined) {
    const v = parseNumberish(input.version);
    if (v !== WOD_VERSION) errors.push(`Versión de formato no compatible (${String(input.version)}). Esta app lee la versión ${WOD_VERSION}.`);
  }
  if (input.formato === undefined || input.version === undefined) {
    ctx.warnings.push(`Faltan «formato» o «version»: se interpreta como ${WOD_FORMAT} v${WOD_VERSION}.`);
  }
  if (input.bloques !== undefined && !Array.isArray(input.bloques)) errors.push("«bloques» debe ser una lista.");
  if (errors.length) return { ok: false, errors };

  ctx.extraKeys(input, ROOT_KEYS, "wod");
  // Identificadores únicos en todo el WOD (bloques, ejercicios y calentamiento)
  const blockIds = new Set<string>();
  const itemIds = blockIds;

  const rawBlocks = (input.bloques as unknown[] | undefined) ?? [];
  if (rawBlocks.length > MAX_BLOCKS) ctx.warnings.push(`El WOD tiene más de ${MAX_BLOCKS} bloques; se han leído los ${MAX_BLOCKS} primeros.`);
  const bloques: WodBlock[] = [];
  rawBlocks.slice(0, MAX_BLOCKS).forEach((b, i) => {
    if (!isObj(b)) { ctx.keep(`bloques[${i}]`, b); return; }
    bloques.push(readBlock(b, `bloques[${i}]`, ctx, blockIds, itemIds));
  });

  let calentamiento: WodWarmup | null = null;
  if (isObj(input.calentamiento)) {
    const c = input.calentamiento;
    ctx.extraKeys(c, ["rondas", "ejercicios", "notas"], "calentamiento");
    calentamiento = {
      rondas: pos(c.rondas, "calentamiento.rondas", ctx, { int: true, max: 100 }),
      ejercicios: readItems(c.ejercicios, "calentamiento.ejercicios", ctx, itemIds, "c"),
      notas: str(c.notas, "calentamiento.notas", ctx),
    };
    if (!calentamiento.ejercicios.length && calentamiento.rondas === null && !calentamiento.notas) calentamiento = null;
  } else if (typeof input.calentamiento === "string") {
    calentamiento = { rondas: null, ejercicios: [], notas: str(input.calentamiento, "calentamiento", ctx) };
  } else if (input.calentamiento !== undefined && input.calentamiento !== null) ctx.keep("calentamiento", input.calentamiento);

  if (!bloques.length && !calentamiento) {
    return { ok: false, errors: ["El WOD no tiene ningún bloque ni calentamiento reconocible. Revisa que el texto pegado sea el bloque completo."] };
  }

  let fecha = str(input.fecha, "fecha", ctx, 40);
  let fechaTexto = str(input.fecha_texto, "fecha_texto", ctx, 80);
  if (fecha && !isValidISODate(fecha)) {
    // Sin año o en otro formato: no se completa; se conserva como texto visible
    ctx.warnings.push(`La fecha «${fecha}» no es una fecha completa (AAAA-MM-DD): se conserva como texto y la fecha queda sin determinar.`);
    if (!fechaTexto) fechaTexto = fecha;
    fecha = null;
  }

  // Conserva lo no reconocido que ya trajera un WOD guardado previamente
  if (Array.isArray(input.no_reconocido)) {
    for (const x of input.no_reconocido) if (isObj(x) && typeof x.ruta === "string" && typeof x.valor === "string") ctx.unrecognized.push({ ruta: x.ruta, valor: x.valor });
  }

  const wod: WodSpec = {
    formato: WOD_FORMAT,
    version: WOD_VERSION,
    nombre: str(input.nombre, "nombre", ctx, 200),
    fecha,
    fecha_texto: fechaTexto,
    modalidad: enumOf<WodModality>(input.modalidad, { individual: "individual", parejas: "parejas", pareja: "parejas", pairs: "parejas", "por parejas": "parejas", "en parejas": "parejas" }, "modalidad", ctx),
    transcripcion: str(input.transcripcion, "transcripcion", ctx, MAX_TRANSCRIPTION),
    calentamiento,
    bloques,
    resumen_enfoque: str(input.resumen_enfoque, "resumen_enfoque", ctx),
    notas: str(input.notas, "notas", ctx),
    ambiguedades: strList(input.ambiguedades, "ambiguedades", ctx) ?? [],
    no_reconocido: ctx.unrecognized,
  };
  if (ctx.unrecognized.some((u) => /result|realiz|score|marca|tiempo_final|hecho/i.test(u.ruta))) {
    ctx.warnings.push("El bloque trae datos que parecen resultados: no se importan como realizados. Regístralos tú en la actividad.");
  }
  if (ctx.unrecognized.some((u) => u.valor.includes("|"))) {
    ctx.warnings.push("Algún valor contiene «|»: parece copiado de la lista de opciones de la plantilla. Elige un solo valor.");
  }
  if (ctx.unrecognized.length) ctx.warnings.push(`${ctx.unrecognized.length} dato(s) no encajan en el formato: se conservan en «No reconocido» para que los revises.`);
  return { ok: true, wod, warnings: ctx.warnings };
}

function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ---------------------------------------------------------------------
// Extracción del JSON dentro del texto pegado
// ---------------------------------------------------------------------
/** Devuelve el candidato a JSON: el contenido de un bloque ``` o el tramo entre la primera «{» y la última «}». */
export function extractJsonCandidate(text: string): string | null {
  const fence = /```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/.exec(text);
  if (fence && fence[1].trim().startsWith("{")) return fence[1].trim();
  // Sin delimitadores (o con el de cierre perdido al copiar)
  const body = text.replace(/^[ \t]*```[a-zA-Z0-9_-]*[ \t]*$/gm, "");
  const first = body.indexOf("{");
  if (first === -1) return null;
  const last = body.lastIndexOf("}");
  // Si falta la llave de cierre se devuelve igualmente para dar un error útil en vez de ignorarlo
  return last > first ? body.slice(first, last + 1) : body.slice(first);
}

function jsonErrorPosition(candidate: string, err: unknown): string {
  const m = /position (\d+)/i.exec(err instanceof Error ? err.message : "");
  if (!m) return "";
  const pos = Number(m[1]);
  const before = candidate.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  return ` (línea ${line}, columna ${col} del bloque JSON)`;
}

/** Llaves o corchetes sin cerrar al final del texto: el bloque se ha cortado. */
function looksTruncated(json: string): boolean {
  let depth = 0, inStr = false, esc = false;
  for (const ch of json) {
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return inStr || depth > 0;
}

/** Normaliza comillas tipográficas que algunos editores introducen y rompen el JSON. */
function normalizeQuotes(s: string): string {
  return s.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/ /g, " ");
}

// ---------------------------------------------------------------------
// Formato sencillo antiguo
// ---------------------------------------------------------------------
const PENDING_WORDS = /^(revisar|\?+|pendiente|n\/?d|-|—)$/i;

function legacyNumber(s: string, allowDecimal: boolean): number | null | "pending" | "invalid" {
  const t = s.trim().replace(/\s*kg$/i, "").trim();
  if (!t) return null;
  if (PENDING_WORDS.test(t)) return "pending";
  const re = allowDecimal ? /^\d+([.,]\d+)?$/ : /^\d+$/;
  if (!re.test(t)) return "invalid";
  const n = Number(t.replace(",", "."));
  return n;
}

/** Lee la tabla «Ejercicio | Serie | Reps | Peso(kg)». Tolera encabezados, separadores, «|» inicial y final, coma decimal y «revisar». */
export function parseLegacyTable(text: string): { rows: LegacyRow[]; unrecognized: string[] } {
  const rows: LegacyRow[] = [];
  const unrecognized: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^```/.test(line)) continue;
    if (!line.includes("|")) { unrecognized.push(line); continue; }
    const cols = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cols.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue; // separador de tabla
    if (/^ejercicio$/i.test(cols[0])) continue; // encabezado
    if (cols.length < 4 || !cols[0]) { unrecognized.push(line); continue; }
    const [exercise, serieRaw, repsRaw, pesoRaw] = cols;
    const serie = legacyNumber(serieRaw, false);
    const reps = legacyNumber(repsRaw, false);
    const peso = legacyNumber(pesoRaw, true);
    if (serie === "invalid" || reps === "invalid" || peso === "invalid") { unrecognized.push(line); continue; }
    const setNumber = typeof serie === "number" && serie >= 1
      ? serie
      : rows.filter((r) => r.exercise === exercise).length + 1;
    rows.push({
      exercise: exercise.slice(0, 200),
      set_number: Math.min(setNumber, 100),
      reps: typeof reps === "number" ? reps : null,
      // 0 kg no se distingue de «sin dato» en este formato: se trata como pendiente de aclarar
      weight_kg: typeof peso === "number" && peso > 0 ? peso : null,
      pending: peso === "pending" || reps === "pending" || peso === 0,
    });
  }
  return { rows, unrecognized };
}

// ---------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------
export function parseWodInput(text: string): WodParseResult {
  if (!text.trim()) return { kind: "error", errors: ["No hay texto. Pega el bloque que te ha devuelto ChatGPT."] };
  if (text.length > MAX_INPUT_CHARS) return { kind: "error", errors: [`El texto es demasiado largo (${text.length} caracteres; máximo ${MAX_INPUT_CHARS}).`] };

  const fences = [...text.matchAll(/```[a-zA-Z0-9_-]*[ \t]*\r?\n\s*\{/g)].length;
  if (fences > 1) {
    return { kind: "error", errors: [`El texto contiene ${fences} bloques JSON. Cada importación es un único WOD: pega solo uno y repite la importación para el resto.`] };
  }
  // Una lista de WOD ([{…},{…}]) se detecta antes de buscar un objeto suelto
  const bare = text.replace(/^[ \t]*```[a-zA-Z0-9_-]*[ \t]*$/gm, "").trim();
  if (bare.startsWith("[")) {
    try {
      const v = validateWod(JSON.parse(normalizeQuotes(bare)));
      if (!v.ok) return { kind: "error", errors: v.errors };
    } catch { /* no es una lista JSON completa: se sigue con el resto de comprobaciones */ }
  }
  const candidate = extractJsonCandidate(text);
  if (candidate) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(normalizeQuotes(candidate));
    } catch (e) {
      // Si no parece JSON pero sí una tabla antigua, se intenta ese formato
      const legacy = parseLegacyTable(text);
      if (legacy.rows.length) return { kind: "legacy", ...legacy, warnings: [] };
      if (looksTruncated(candidate)) {
        return { kind: "error", errors: [
          "El bloque está incompleto: falta el final (se ha cortado al copiar).",
          "Copia de nuevo el bloque entero con el botón de copiar; debe terminar en «}».",
        ] };
      }
      return { kind: "error", errors: [
        `El bloque parece JSON pero no se puede leer${jsonErrorPosition(candidate, e)}. Suele deberse a que falta una coma, una comilla o una llave de cierre al copiar.`,
        "Copia de nuevo el bloque completo con el botón de copiar de ChatGPT.",
      ] };
    }
    const v = validateWod(parsed);
    if (!v.ok) return { kind: "error", errors: v.errors };
    return { kind: "wod", wod: v.wod, warnings: v.warnings };
  }

  const legacy = parseLegacyTable(text);
  if (legacy.rows.length) {
    const warnings: string[] = [];
    if (legacy.unrecognized.length) warnings.push(`${legacy.unrecognized.length} línea(s) no tienen el formato de la tabla: se muestran para revisarlas.`);
    return { kind: "legacy", ...legacy, warnings };
  }
  return { kind: "error", errors: [
    "No se ha reconocido ni un bloque JSON del WOD ni la tabla «Ejercicio | Serie | Reps | Peso(kg)».",
    "Comprueba que has copiado el bloque completo que devuelve el prompt (empieza por { y termina por }).",
  ] };
}

// ---------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------
export function fmtSeconds(s: number | null): string | null {
  if (s === null) return null;
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r ? `${m} min ${r} s` : `${m} min`;
}

const TARGET_UNIT: Record<WodTargetType, string> = {
  reps: "reps", segundos: "s", metros: "m", calorias: "cal", max_reps: "reps", max_calorias: "cal", otro: "",
};

/** Texto del objetivo previsto, con su unidad. Nunca inventa un valor que no venga en el WOD. */
export function describeTarget(t: WodTarget | null): string | null {
  if (!t) return null;
  const unit = t.tipo ? TARGET_UNIT[t.tipo] : "";
  const side = t.por_lado ? " por lado" : "";
  if (t.tipo === "max_reps" || t.tipo === "max_calorias") {
    return `Máximas ${t.tipo === "max_reps" ? "repeticiones" : "calorías"}${side}`;
  }
  if (t.por_ronda?.length) return `${t.por_ronda.join("-")} ${unit}${side}`.trim() + " (por ronda)";
  if (t.alternativas?.length) return `${t.alternativas.join(" o ")} ${unit}${side}`.trim() + " · alternativas sin decidir";
  if (t.valor !== null) {
    if (t.tipo === "segundos") return `${fmtSeconds(t.valor)}${side}`;
    return `${t.valor} ${unit}${side}`.trim();
  }
  return t.texto;
}

export function describeLoad(l: WodLoad | null): string | null {
  if (!l) return null;
  if (l.kg !== null && l.implementos !== null && l.implementos > 1 && l.modo !== "total") return `${l.implementos} × ${fmtKg(l.kg)} kg`;
  if (l.kg !== null) return `${fmtKg(l.kg)} kg${l.modo === "total" ? " (total)" : ""}`;
  if (l.implementos !== null) return `${l.implementos} implemento${l.implementos > 1 ? "s" : ""} · peso sin indicar`;
  return l.texto;
}

function fmtKg(n: number): string {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(n);
}

/** Resumen corto de la estructura del bloque para su cabecera. */
export function describeBlockStructure(b: WodBlock): string[] {
  const parts: string[] = [];
  if (b.tipo === "emom" && b.intervalo_s && b.intervalo_s !== 60) parts.push(`cada ${fmtSeconds(b.intervalo_s)}`);
  if (b.duracion_s !== null) parts.push(`Duración ${fmtSeconds(b.duracion_s)}`);
  if (b.rondas !== null) parts.push(`${b.rondas} ronda${b.rondas > 1 ? "s" : ""}`);
  if (b.limite_tiempo_s !== null) parts.push(`Límite ${fmtSeconds(b.limite_tiempo_s)}`);
  if (b.indicacion_tiempo) parts.push(`Indicación «${b.indicacion_tiempo}» (significado sin confirmar)`);
  return parts;
}

export function describeRpe(r: WodRpe): string {
  if (r.desde_ronda !== null && r.hasta_ronda !== null && r.desde_ronda !== r.hasta_ronda) return `Rondas ${r.desde_ronda}-${r.hasta_ronda}: RPE ${r.valor}`;
  if (r.desde_ronda !== null) return `Ronda ${r.desde_ronda}: RPE ${r.valor}`;
  return `RPE ${r.valor}`;
}

/** Bloques con resultado propio: AMRAP (rondas + reps) y For Time (tiempo). EMOM, rondas sin cronómetro y descansos no puntúan. */
export function isScoredBlock(b: WodBlock): boolean {
  return b.tipo === "amrap" || b.tipo === "for_time";
}

/** Ejercicios con carga externa (los que tienen «carga», aunque sin kilos: «2DB», «KB», «100/80»…). Excluye el calentamiento. */
export function loadedItems(w: WodSpec): { block: WodBlock; item: WodItem }[] {
  // Un mismo ejercicio repetido en el WOD (p. ej. wall ball en rondas y en «THEN») se pide una sola vez
  const seen = new Set<string>();
  return w.bloques.flatMap((b) => b.ejercicios.filter((it) => it.carga !== null).map((item) => ({ block: b, item })))
    .filter(({ item }) => {
      const k = item.nombre.trim().toLowerCase().replace(/\s+/g, " ");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Resumen corto de la estructura principal («AMRAP 10' ×3», «For Time», «EMOM 6' ×4»). */
export function structureSummary(w: WodSpec): string {
  const main = w.bloques.filter((b) => b.tipo !== "descanso");
  const parts: { label: string; n: number }[] = [];
  for (const b of main) {
    const dur = b.duracion_s ? ` ${Math.round(b.duracion_s / 60)}'` : "";
    const label = b.tipo === "emom" && b.intervalo_s && b.intervalo_s !== 60
      ? `Every ${Math.round(b.intervalo_s / 60)}'${b.rondas ? ` ×${b.rondas}` : ""}`
      : b.tipo === "otro" || b.tipo === "rondas"
      ? (b.rondas ? `${b.rondas} rondas` : BLOCK_TYPE_LABEL[b.tipo])
      : `${BLOCK_TYPE_LABEL[b.tipo]}${b.tipo === "for_time" ? "" : dur}`;
    const last = parts[parts.length - 1];
    if (last && last.label === label) last.n++; else parts.push({ label, n: 1 });
  }
  return parts.map((p) => (p.n > 1 ? `${p.label} ×${p.n}` : p.label)).join(" + ");
}

/** Etiquetas útiles para listados (EMOM, For Time, Parejas…), sin repetir. */
export function wodTags(w: WodSpec): string[] {
  const tags = new Set<string>();
  for (const b of w.bloques) if (b.tipo !== "descanso" && b.tipo !== "otro" && b.tipo !== "rondas") tags.add(BLOCK_TYPE_LABEL[b.tipo]);
  if (w.modalidad === "parejas") tags.add("Parejas");
  return [...tags];
}

/** Clave estable para un intento de importación (evita duplicados por doble pulsación o reintento). */
export function newClientRef(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
