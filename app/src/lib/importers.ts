// Importación manual de actividades (FIT, GPX y TCX), procesada en el
// navegador. Sirve como alternativa si Intervals.icu deja de ofrecer por
// API los datos procedentes de Garmin.
import { todayISO } from "./dates";
import type { ParsedImport, Sport, Streams } from "./types";

const R = 6371000;
function haversine(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function elevationGain(alt: number[]): number | null {
  if (alt.length < 2) return null;
  // Umbral de 2 m para no acumular ruido del altímetro
  let gain = 0;
  let ref = alt[0];
  for (const v of alt) {
    if (v - ref >= 2) { gain += v - ref; ref = v; }
    else if (ref - v >= 2) ref = v;
  }
  return gain;
}

function stats(values: number[]) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  if (!v.length) return { avg: null, max: null };
  return { avg: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max(...v) };
}

function localDateOf(iso: string | null): string {
  return iso ? todayISO("Europe/Madrid", new Date(iso)) : todayISO();
}

function guessFromSport(sport: string, sub?: string): { sport: Sport; reason: string } {
  const s = (sport || "").toLowerCase();
  const ss = (sub || "").toLowerCase();
  if (s.includes("e_biking") || s.includes("ebik") || ss.includes("e_bike") || ss.includes("ebike")) {
    return { sport: "emtb", reason: "El archivo indica bicicleta eléctrica. Confirma si es de montaña." };
  }
  if (s.includes("cycl") || s.includes("bik")) {
    return ss.includes("mountain")
      ? { sport: "mtb", reason: "El archivo indica ciclismo de montaña. Confirma que no es la e-MTB." }
      : { sport: "otro", reason: "El archivo indica ciclismo sin especificar: elige MTB o e-MTB." };
  }
  if (s.includes("run")) return { sport: "run", reason: "El archivo indica carrera." };
  if (s.includes("train") || s.includes("fitness") || s.includes("hiit") || s.includes("strength")) {
    return { sport: "hiit", reason: "El archivo indica entrenamiento de fuerza o HIIT." };
  }
  return { sport: "otro", reason: "Tipo de actividad no reconocido: elige la categoría." };
}

function finish(base: Omit<ParsedImport, "localDate" | "distanceM" | "elevationGainM" | "avgHr" | "maxHr"> & {
  distanceM?: number | null; elevationGainM?: number | null; avgHr?: number | null; maxHr?: number | null;
}): ParsedImport {
  const s = base.streams;
  const hr = stats(s.heartrate ?? []);
  let distance = base.distanceM ?? null;
  if (distance === null && s.latlng && s.latlng.length > 1) {
    distance = 0;
    for (let i = 1; i < s.latlng.length; i++) distance += haversine(s.latlng[i - 1], s.latlng[i]);
  }
  return {
    ...base,
    localDate: localDateOf(base.startTime),
    distanceM: distance,
    elevationGainM: base.elevationGainM ?? (s.altitude ? elevationGain(s.altitude) : null),
    avgHr: base.avgHr ?? hr.avg,
    maxHr: base.maxHr ?? hr.max,
  };
}

function textOf(el: Element, selector: string): string | null {
  const n = el.getElementsByTagName(selector)[0] ?? el.querySelector(selector);
  return n?.textContent ?? null;
}

export function parseGpx(xml: string, fileName: string): ParsedImport {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("El archivo GPX no es válido.");
  const pts = Array.from(doc.getElementsByTagName("trkpt"));
  if (!pts.length) throw new Error("El GPX no contiene puntos de recorrido.");
  const times: number[] = [];
  const streams: Streams = { latlng: [], altitude: [], heartrate: [], cadence: [], time: [] };
  for (const p of pts) {
    const lat = Number(p.getAttribute("lat"));
    const lon = Number(p.getAttribute("lon"));
    streams.latlng!.push([lat, lon]);
    const ele = textOf(p, "ele");
    if (ele) streams.altitude!.push(Number(ele));
    const t = textOf(p, "time");
    if (t) times.push(Date.parse(t));
    const hr = p.getElementsByTagNameNS("*", "hr")[0]?.textContent;
    if (hr) streams.heartrate!.push(Number(hr));
    const cad = p.getElementsByTagNameNS("*", "cad")[0]?.textContent;
    if (cad) streams.cadence!.push(Number(cad));
  }
  const start = times.length ? times[0] : null;
  streams.time = times.map((t) => Math.round((t - (start as number)) / 1000));
  for (const k of Object.keys(streams) as (keyof Streams)[]) if (!streams[k]?.length) delete streams[k];
  const typeText = doc.getElementsByTagName("type")[0]?.textContent ?? "";
  const g = guessFromSport(typeText);
  const duration = times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : null;
  return finish({
    fileName, format: "gpx", startTime: start ? new Date(start).toISOString() : null,
    suggested: g.sport, suggestedReason: g.reason, sourceType: typeText || null,
    durationS: duration, movingTimeS: null, avgSpeedMs: null, avgCadence: stats(streams.cadence ?? []).avg,
    avgPowerW: null, calories: null, streams,
  });
}

export function parseTcx(xml: string, fileName: string): ParsedImport {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("El archivo TCX no es válido.");
  const act = doc.getElementsByTagName("Activity")[0];
  if (!act) throw new Error("El TCX no contiene ninguna actividad.");
  const sport = act.getAttribute("Sport") ?? "";
  const laps = Array.from(act.getElementsByTagName("Lap"));
  const sumLaps = (tag: string) => laps.reduce((a, l) => a + Number(textOf(l, tag) ?? 0), 0);
  const tps = Array.from(act.getElementsByTagName("Trackpoint"));
  const times: number[] = [];
  const streams: Streams = { latlng: [], altitude: [], heartrate: [], cadence: [], distance: [], time: [] };
  for (const tp of tps) {
    const t = textOf(tp, "Time");
    if (t) times.push(Date.parse(t));
    const lat = textOf(tp, "LatitudeDegrees");
    const lon = textOf(tp, "LongitudeDegrees");
    if (lat && lon) streams.latlng!.push([Number(lat), Number(lon)]);
    const alt = textOf(tp, "AltitudeMeters");
    if (alt) streams.altitude!.push(Number(alt));
    const hrEl = tp.getElementsByTagName("HeartRateBpm")[0];
    if (hrEl) streams.heartrate!.push(Number(textOf(hrEl, "Value")));
    const cad = textOf(tp, "Cadence");
    if (cad) streams.cadence!.push(Number(cad));
    const d = textOf(tp, "DistanceMeters");
    if (d) streams.distance!.push(Number(d));
  }
  const start = times.length ? times[0] : laps[0]?.getAttribute("StartTime") ? Date.parse(laps[0].getAttribute("StartTime") as string) : null;
  streams.time = times.map((t) => Math.round((t - (start as number)) / 1000));
  for (const k of Object.keys(streams) as (keyof Streams)[]) if (!streams[k]?.length) delete streams[k];
  const g = guessFromSport(sport);
  const totalTime = sumLaps("TotalTimeSeconds");
  const dist = sumLaps("DistanceMeters");
  const cal = sumLaps("Calories");
  return finish({
    fileName, format: "tcx", startTime: start ? new Date(start).toISOString() : null,
    suggested: g.sport, suggestedReason: g.reason, sourceType: sport || null,
    durationS: times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : totalTime || null,
    movingTimeS: totalTime || null, distanceM: dist || null, avgSpeedMs: null,
    avgCadence: stats(streams.cadence ?? []).avg, avgPowerW: null, calories: cal || null, streams,
  });
}

export async function parseFit(buffer: ArrayBuffer, fileName: string): Promise<ParsedImport> {
  const { Decoder, Stream } = await import("@garmin/fitsdk");
  const decoder = new Decoder(Stream.fromArrayBuffer(buffer));
  if (!decoder.isFIT()) throw new Error("El archivo no es un FIT válido.");
  const { messages } = decoder.read();
  const session = (messages.sessionMesgs?.[0] ?? {}) as Record<string, unknown>;
  const records = (messages.recordMesgs ?? []) as Record<string, unknown>[];
  const SEMI = 180 / 2 ** 31;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const startDate = (session.startTime as Date | undefined) ?? (records[0]?.timestamp as Date | undefined) ?? null;
  const start = startDate ? new Date(startDate).getTime() : null;
  const streams: Streams = { time: [], heartrate: [], latlng: [], altitude: [], distance: [], velocity_smooth: [], cadence: [], watts: [] };
  for (const r of records) {
    const ts = r.timestamp ? new Date(r.timestamp as Date).getTime() : null;
    if (ts !== null && start !== null) streams.time!.push(Math.round((ts - start) / 1000));
    const hr = num(r.heartRate); if (hr !== null) streams.heartrate!.push(hr);
    const lat = num(r.positionLat); const lon = num(r.positionLong);
    if (lat !== null && lon !== null) streams.latlng!.push([lat * SEMI, lon * SEMI]);
    const alt = num(r.enhancedAltitude) ?? num(r.altitude); if (alt !== null) streams.altitude!.push(alt);
    const d = num(r.distance); if (d !== null) streams.distance!.push(d);
    const v = num(r.enhancedSpeed) ?? num(r.speed); if (v !== null) streams.velocity_smooth!.push(v);
    const c = num(r.cadence); if (c !== null) streams.cadence!.push(c);
    const w = num(r.power); if (w !== null) streams.watts!.push(w);
  }
  for (const k of Object.keys(streams) as (keyof Streams)[]) if (!streams[k]?.length) delete streams[k];
  const g = guessFromSport(String(session.sport ?? ""), String(session.subSport ?? ""));
  return finish({
    fileName, format: "fit", startTime: start ? new Date(start).toISOString() : null,
    suggested: g.sport, suggestedReason: g.reason,
    sourceType: [session.sport, session.subSport].filter(Boolean).join(" / ") || null,
    durationS: num(session.totalElapsedTime), movingTimeS: num(session.totalTimerTime),
    distanceM: num(session.totalDistance), elevationGainM: num(session.totalAscent),
    avgHr: num(session.avgHeartRate), maxHr: num(session.maxHeartRate),
    avgSpeedMs: num(session.enhancedAvgSpeed) ?? num(session.avgSpeed),
    avgCadence: num(session.avgCadence),
    // Potencia del ciclista: solo si el archivo trae medición de potencia
    avgPowerW: streams.watts?.length ? num(session.avgPower) : null,
    calories: num(session.totalCalories), streams,
  });
}

export async function parseActivityFile(file: File): Promise<ParsedImport> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".fit")) return parseFit(await file.arrayBuffer(), file.name);
  if (name.endsWith(".gpx")) return parseGpx(await file.text(), file.name);
  if (name.endsWith(".tcx")) return parseTcx(await file.text(), file.name);
  throw new Error("Formato no compatible. Usa archivos .fit, .gpx o .tcx.");
}
