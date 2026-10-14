// DATOS DE DEMOSTRACIÓN
// Generados en memoria con una semilla fija. Nunca se escriben en la base
// de datos ni se mezclan con datos reales, y la interfaz los identifica
// siempre como «Datos de demostración».
import { addDays, isoWeekday, todayISO } from "../lib/dates";
import { makeDisplayVersion } from "../lib/photos";
import type {
  Activity, Checkin, CoachMessage, CoachPayload, DataBundle, Feedback, Framing, Measurement, ParsedImport,
  PhotoEntry, PhotoFile, PlannedDraft, PlannedSession, Pose, Profile, Sport, StrengthEntry, StrengthSet, Streams, Wellness,
  Workout, WorkoutDraft, BlockResult,
} from "../lib/types";
import { buildSession } from "../lib/coach";
import type { Repo } from "./repo";

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

let idCounter = 0;
const nid = (p: string) => `demo-${p}-${++idCounter}`;

interface Gen { acts: Activity[]; streams: Map<string, Streams>; }

function zonesFor(sport: Sport, durS: number, hard: boolean, r: () => number): number[] {
  const shares = sport === "hiit"
    ? hard ? [0.18, 0.17, 0.2, 0.2, 0.15, 0.07, 0.03] : [0.35, 0.25, 0.2, 0.12, 0.06, 0.02, 0]
    : sport === "emtb" ? [0.25, 0.45, 0.2, 0.08, 0.02, 0, 0]
      : sport === "mtb" ? hard ? [0.15, 0.3, 0.25, 0.2, 0.08, 0.02, 0] : [0.2, 0.4, 0.25, 0.12, 0.03, 0, 0]
        : [0.2, 0.45, 0.25, 0.08, 0.02, 0, 0];
  return shares.map((s) => Math.round(durS * s * (0.85 + r() * 0.3)));
}

function makeStreams(sport: Sport, durS: number, avgHr: number, r: () => number, distanceM: number | null): Streams {
  const step = 5;
  const n = Math.floor(durS / step);
  const time = Array.from({ length: n }, (_, i) => i * step);
  const heartrate = time.map((t, i) => {
    const warm = Math.min(1, t / 600);
    const wave = sport === "hiit" ? Math.sin(i / 18) * 14 : Math.sin(i / 60) * 7;
    return Math.round((avgHr - 18) + warm * 18 + wave + (r() - 0.5) * 4);
  });
  const s: Streams = { time, heartrate };
  if (sport !== "hiit" && distanceM) {
    // Recorrido ficticio en bucle (no corresponde a ningún lugar real del usuario)
    const cLat = 40.0, cLng = -3.0, rad = distanceM / (2 * Math.PI) / 111000;
    s.latlng = time.map((_, i) => {
      const a = (i / n) * 2 * Math.PI;
      return [cLat + rad * Math.sin(a) * (1 + 0.15 * Math.sin(3 * a)), cLng + rad * Math.cos(a) * 1.25];
    });
    s.altitude = time.map((_, i) => 820 + 160 * Math.sin((i / n) * Math.PI) + 35 * Math.sin((i / n) * 9 * Math.PI));
    s.distance = time.map((_, i) => (distanceM * i) / n);
    s.velocity_smooth = time.map(() => distanceM / durS * (0.8 + r() * 0.4));
    s.cadence = time.map(() => (sport === "run" ? 82 : 76) + Math.round((r() - 0.5) * 10));
  }
  return s;
}

function generateActivities(today: string): Gen {
  const r = rng(20261011);
  const acts: Activity[] = [];
  const streams = new Map<string, Streams>();
  for (let back = 84; back >= 1; back--) {
    const d = addDays(today, -back);
    const wd = isoWeekday(d);
    const week = Math.floor(back / 7);
    let sport: Sport | null = null;
    let hard = false;
    if (wd === 1) { sport = "hiit"; hard = true; }
    if (wd === 2) sport = "emtb";
    if (wd === 4) { sport = "hiit"; hard = week % 2 === 0; }
    if (wd === 6) { sport = week % 2 === 0 ? "mtb" : "emtb"; hard = sport === "mtb"; }
    if (wd === 7 && week % 2 === 1) sport = "run";
    if (!sport || r() < 0.12) continue;
    const durS = sport === "hiit" ? 2400 + Math.round(r() * 1500)
      : sport === "emtb" ? 5400 + Math.round(r() * 3600)
        : sport === "mtb" ? 4800 + Math.round(r() * 2400) : 2100 + Math.round(r() * 1200);
    const avgHr = sport === "hiit" ? (hard ? 142 : 128) : sport === "emtb" ? 124 : sport === "mtb" ? 141 : 146;
    const dist = sport === "hiit" ? null : sport === "emtb" ? durS * 5.3 : sport === "mtb" ? durS * 3.9 : durS * 2.85;
    const zones = zonesFor(sport, durS, hard, r);
    const load = Math.round((durS / 3600) * (sport === "hiit" ? (hard ? 78 : 58) : sport === "emtb" ? 42 : sport === "mtb" ? 66 : 60) * (0.9 + r() * 0.2));
    const id = nid("act");
    const start = `${d}T${sport === "hiit" ? "18:30" : "09:15"}:00Z`;
    const typeMap: Record<Sport, string> = { hiit: "HighIntensityIntervalTraining", emtb: "EMountainBikeRide", mtb: "MountainBikeRide", run: "Run", otro: "Workout" };
    const titles: Record<Sport, string[]> = {
      hiit: ["Fuerza en rack + intervalos", "HIIT tipo Hyrox", "Circuito funcional EMOM"],
      emtb: ["e-MTB senderos Z2", "e-MTB pistas y subidas"],
      mtb: ["MTB subidas técnicas", "MTB ruta de fondo"],
      run: ["Rodaje suave", "Carrera progresiva"],
      otro: ["Entrenamiento"],
    };
    const ambiguous = sport === "emtb" && back === 30; // un caso ambiguo para revisar
    acts.push({
      id, source: "intervals", external_id: id, data_origin: "medido", start_time: start, local_date: d,
      name: titles[sport][Math.floor(r() * titles[sport].length)],
      source_type: ambiguous ? "Ride" : typeMap[sport],
      category_auto: ambiguous ? "otro" : sport, category_ambiguous: ambiguous, category_override: null,
      category: ambiguous ? "otro" : sport, category_needs_review: ambiguous,
      duration_s: durS + 120, moving_time_s: durS, distance_m: dist, elevation_gain_m: dist ? Math.round(dist / 1000 * (sport === "run" ? 12 : 22)) : null,
      avg_hr: avgHr, max_hr: avgHr + 28 + Math.round(r() * 8), avg_speed_ms: dist ? dist / durS : null, max_speed_ms: dist ? (dist / durS) * 2.1 : null,
      avg_cadence: dist ? (sport === "run" ? 82 : 76) : null, rider_avg_power_w: null, rider_power_source: null,
      training_load: load, intensity: null, trimp: null, calories: Math.round((durS / 3600) * (sport === "emtb" ? 430 : 620)),
      hr_zone_times_s: zones, hr_zone_bounds: [118, 132, 145, 156, 166, 175, 190],
      device_name: "Demostración", has_gps: Boolean(dist), has_heartrate: true,
      stream_types: dist ? ["time", "heartrate", "latlng", "altitude", "distance", "velocity_smooth", "cadence"] : ["time", "heartrate"],
      api_restricted: false, last_synced_at: null,
    });
    streams.set(id, makeStreams(sport, durS, avgHr, r, dist));
  }
  return { acts: acts.reverse(), streams };
}

function generateWellness(today: string, acts: Activity[]): Wellness[] {
  const r = rng(77);
  const out: Wellness[] = [];
  let ctl = 18, atl = 16;
  for (let back = 120; back >= 0; back--) {
    const d = addDays(today, -back);
    const load = acts.filter((a) => a.local_date === d).reduce((s, a) => s + (a.training_load ?? 0), 0);
    ctl = ctl + (load - ctl) / 42;
    atl = atl + (load - atl) / 7;
    const hasNight = back <= 84 && r() > 0.08;
    out.push({
      date: d, source: "demo",
      resting_hr: hasNight ? Math.round(49 + (r() - 0.5) * 5) : null,
      hrv: hasNight ? Math.round(56 + (r() - 0.5) * 12) : null,
      sleep_secs: hasNight ? Math.round((6.4 + r() * 1.8) * 3600) : null,
      sleep_score: hasNight ? Math.round(68 + r() * 25) : null,
      sleep_quality: null, steps: hasNight ? Math.round(6000 + r() * 7000) : null,
      ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, ramp_rate: null, last_synced_at: null,
    });
  }
  return out;
}

function generateMeasurements(today: string): Measurement[] {
  const r = rng(5);
  const out: Measurement[] = [];
  for (let back = 80; back >= 0; back -= 3 + Math.floor(r() * 4)) {
    out.push({
      id: nid("meas"), source: "intervals", measured_on: addDays(today, -back),
      weight_kg: Math.round((78.6 - (80 - back) * 0.014 + (r() - 0.5) * 0.6) * 10) / 10,
      body_fat_pct: Math.round((16.4 - (80 - back) * 0.008 + (r() - 0.5) * 0.4) * 10) / 10,
      waist_cm: null, data_origin: "medido", notes: null, last_synced_at: null,
    });
  }
  return out;
}

/** Progresión de ejemplo en dos ejercicios, usando los días de HIIT como fecha de referencia. */
function generateStrengthSets(acts: Activity[]): { entries: StrengthEntry[]; byActivity: Map<string, StrengthSet[]> } {
  const r = rng(33);
  const hiitDays = acts.filter((a) => a.category === "hiit").sort((a, b) => a.local_date.localeCompare(b.local_date));
  const entries: StrengthEntry[] = [];
  const byActivity = new Map<string, StrengthSet[]>();
  const add = (activityId: string, date: string, set: Omit<StrengthSet, "id">) => {
    const id = nid("set");
    entries.push({ ...set, id, date });
    byActivity.set(activityId, [...(byActivity.get(activityId) ?? []), { ...set, id }]);
  };
  let squat = 62, wallBall = 7;
  hiitDays.forEach((a, i) => {
    if (i % 2 !== 0) return; // no todas las sesiones de HIIT incluyen fuerza registrada
    squat += 0.6 + r() * 0.8;
    add(a.id, a.local_date, { exercise: "Sentadilla trasera", set_number: 1, reps: 5, weight_kg: Math.round(squat * 2) / 2, duration_s: null, notes: null });
    if (i % 4 === 0) {
      wallBall = Math.min(9, wallBall + (r() < 0.5 ? 1 : 0));
      add(a.id, a.local_date, { exercise: "Wall ball", set_number: 1, reps: 15, weight_kg: wallBall, duration_s: null, notes: null });
    }
  });
  return { entries, byActivity };
}

function demoToday(today: string, streams: Map<string, Streams>): Activity {
  const r = rng(1013);
  const durS = 46 * 60;
  const id = nid("act");
  streams.set(id, makeStreams("hiit", durS, 141, r, null));
  return {
    id, source: "intervals", external_id: id, data_origin: "medido", start_time: `${today}T07:30:00Z`, local_date: today,
    name: "HIIT tipo Hyrox", source_type: "HighIntensityIntervalTraining", category_auto: "hiit", category_ambiguous: false,
    category_override: null, category: "hiit", category_needs_review: false, duration_s: durS + 60, moving_time_s: durS,
    distance_m: null, elevation_gain_m: null, avg_hr: 141, max_hr: 172, avg_speed_ms: null, max_speed_ms: null, avg_cadence: null,
    rider_avg_power_w: null, rider_power_source: null, training_load: 62, intensity: null, trimp: null, calories: 512,
    hr_zone_times_s: zonesFor("hiit", durS, true, r), hr_zone_bounds: [118, 132, 145, 156, 166, 175, 190],
    device_name: "Demostración", has_gps: false, has_heartrate: true, stream_types: ["time", "heartrate"],
    api_restricted: false, last_synced_at: null,
  };
}

export function buildDemoBundle(today = todayISO()): { bundle: DataBundle; streams: Map<string, Streams>; strengthByActivity: Map<string, StrengthSet[]> } {
  idCounter = 0;
  const { acts, streams } = generateActivities(today);
  const profile: Profile = {
    user_id: "demo", display_name: "Demostración", timezone: "Europe/Madrid",
    units: { weight: "kg", distance: "km", elevation: "m" }, theme: "dark",
    goals: "Ejemplo: mejorar la base aeróbica en e-MTB y mantener dos sesiones de fuerza a la semana.",
    weight_goal_kg: 76, hr_max_bpm: null, available_days: [1, 2, 4, 6, 7], session_minutes_default: 45,
    // Objetivos de ejemplo del panel Hoy
    weight_goal_date: addDays(today, 182), active_kcal_goal: 600, sessions_week_goal: 4, sleep_goal_h: 7.5,
    sport_priority: ["hiit", "emtb", "mtb", "run"], equipment: ["Rack", "Barra olímpica", "Polea con agarres individuales"],
    limitations: null, preferences: null,
  };
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - (isoWeekday(today) - 1)));
  const planned: PlannedSession[] = [];
  const push = (date: string, cat: PlannedSession["category"], intensity: "suave" | "moderada" | "alta", status: PlannedSession["status"], origin: PlannedSession["origin"]) => {
    const s = buildSession(cat, intensity, cat === "emtb" ? 90 : 45, date, profile);
    planned.push({ ...s, id: nid("plan"), status, origin });
  };
  for (const d of week) {
    const wd = isoWeekday(d);
    if (d < today) continue;
    if (wd === 4) push(d, "hiit", "moderada", "planificada", "manual");
    if (wd === 6) push(d, "emtb", "suave", "planificada", "manual");
    if (wd === 7) push(d, "run", "suave", "propuesta", "reglas");
  }
  const checkins: Checkin[] = [{ date: addDays(today, -1), energy: 4, fatigue: 2, soreness: [], sensations: "Bien" }];
  const { entries: strengthSets, byActivity: strengthByActivity } = generateStrengthSets(acts);
  // Sesión de HIIT ya hecha hoy (después de generar las series para no alterar el resto del ejemplo)
  const todayAct = demoToday(today, streams);
  acts.unshift(todayAct);
  return {
    bundle: {
      profile, activities: acts, wellness: generateWellness(today, acts), measurements: generateMeasurements(today),
      checkins, planned, feedback: {}, connection: null, syncRuns: [], photoEntries: [], coachMessages: [],
      strengthSets, workouts: [], wodReady: true, blockResults: [], resultsReady: true,
    },
    streams,
    strengthByActivity,
  };
}

export class DemoRepo implements Repo {
  readonly mode = "demo" as const;
  private bundle: DataBundle;
  private streams: Map<string, Streams>;
  private sets = new Map<string, StrengthSet[]>();
  private blobs = new Map<string, string>();

  constructor() {
    const g = buildDemoBundle();
    this.bundle = g.bundle;
    this.streams = g.streams;
    this.sets = g.strengthByActivity;
  }

  async loadAll(): Promise<DataBundle> {
    // Las series se derivan del estado actual para que la evolución refleje lo guardado en la demo
    const dateOf = new Map(this.bundle.activities.map((a) => [a.id, a.local_date]));
    const strengthSets: StrengthEntry[] = [];
    for (const [actId, sets] of this.sets) {
      const date = dateOf.get(actId);
      if (date) sets.forEach((s, i) => strengthSets.push({ ...s, id: s.id ?? `${actId}-${i}`, date, activity_id: actId }));
    }
    return structuredClone({ ...this.bundle, strengthSets });
  }
  async getStreams(id: string) { return this.streams.get(id) ?? null; }
  async getStrengthSets(id: string) { return structuredClone(this.sets.get(id) ?? []); }
  async saveStrengthSets(id: string, sets: StrengthSet[]) { this.sets.set(id, structuredClone(sets).map((s, i) => ({ ...s, id: s.id ?? nid(`set${i}`) }))); }
  async saveFeedback(fb: Feedback) { this.bundle.feedback[fb.activity_id] = fb; }
  async saveSession(activityId: string, payload: { feedback: Feedback | null; sets: StrengthSet[]; results: BlockResult[] }) {
    // Igual que en la base de datos: todo o nada
    const next = structuredClone(this.bundle.blockResults);
    for (const r of payload.results) {
      const w = this.bundle.workouts.find((x) => x.id === r.workout_id);
      if (!w || w.activity_id !== activityId) throw new Error("Un resultado no corresponde a un WOD de esta actividad");
      const i = next.findIndex((x) => x.workout_id === r.workout_id && x.block_ref === r.block_ref);
      if (i >= 0) next[i] = structuredClone(r); else next.push(structuredClone(r));
    }
    for (const s of payload.sets) {
      if (s.load_mode === "por_implemento" && !s.implements) throw new Error("«Por implemento» necesita el número de implementos");
    }
    this.bundle.blockResults = next;
    if (payload.feedback) this.bundle.feedback[activityId] = structuredClone(payload.feedback);
    await this.saveStrengthSets(activityId, payload.sets);
  }
  async saveWorkout(draft: WorkoutDraft, supersede: string[] = []) {
    const existing = this.bundle.workouts.find((w) => w.client_ref === draft.client_ref);
    if (existing) return structuredClone(existing);
    const w: Workout = { ...structuredClone(draft), id: nid("wod"), superseded_at: null, created_at: new Date().toISOString() };
    this.bundle.workouts.push(w);
    const now = new Date().toISOString();
    for (const x of this.bundle.workouts) if (supersede.includes(x.id) && x.id !== w.id && !x.superseded_at) x.superseded_at = now;
    return structuredClone(w);
  }
  async updateWorkout(id: string, patch: Partial<Pick<Workout, "title" | "wod_date" | "modality" | "spec">>) {
    const w = this.bundle.workouts.find((x) => x.id === id);
    if (w) Object.assign(w, structuredClone(patch));
  }
  async linkWorkout(id: string, link: { activity_id: string | null; planned_session_id: string | null }) {
    const w = this.bundle.workouts.find((x) => x.id === id);
    if (w) Object.assign(w, link);
  }
  async setWorkoutArchived(id: string, archived: boolean) {
    const w = this.bundle.workouts.find((x) => x.id === id);
    if (w) w.superseded_at = archived ? new Date().toISOString() : null;
  }
  async setCategoryOverride(id: string, category: Sport | null) {
    const a = this.bundle.activities.find((x) => x.id === id);
    if (!a) return;
    a.category_override = category;
    a.category = category ?? a.category_auto;
    a.category_needs_review = category === null && a.category_ambiguous;
  }
  async importActivity(p: ParsedImport, category: Sport, name: string) {
    const id = nid("imp");
    this.bundle.activities.push({
      id, source: "import", external_id: id, data_origin: "medido", start_time: p.startTime, local_date: p.localDate, name,
      source_type: p.sourceType, category_auto: category, category_ambiguous: false, category_override: null, category,
      category_needs_review: false, duration_s: p.durationS, moving_time_s: p.movingTimeS, distance_m: p.distanceM,
      elevation_gain_m: p.elevationGainM, avg_hr: p.avgHr, max_hr: p.maxHr, avg_speed_ms: p.avgSpeedMs, max_speed_ms: null,
      avg_cadence: p.avgCadence, rider_avg_power_w: p.avgPowerW, rider_power_source: p.avgPowerW ? "medidor" : null,
      training_load: null, intensity: null, trimp: null, calories: p.calories, hr_zone_times_s: null, hr_zone_bounds: null,
      device_name: p.fileName, has_gps: Boolean(p.streams.latlng?.length), has_heartrate: Boolean(p.streams.heartrate?.length),
      stream_types: Object.keys(p.streams), api_restricted: false, last_synced_at: null,
    });
    this.streams.set(id, p.streams);
    return id;
  }
  async deleteImportedActivity(id: string) {
    this.bundle.activities = this.bundle.activities.filter((a) => !(a.id === id && a.source === "import"));
  }
  async saveCheckin(c: Checkin) {
    this.bundle.checkins = [...this.bundle.checkins.filter((x) => x.date !== c.date), c];
  }
  async savePlanned(p: PlannedDraft) {
    if (p.id) {
      const i = this.bundle.planned.findIndex((x) => x.id === p.id);
      const merged = { ...this.bundle.planned[i], ...p } as PlannedSession;
      this.bundle.planned[i] = merged;
      return merged;
    }
    const s = { ...p, id: nid("plan") } as PlannedSession;
    this.bundle.planned.push(s);
    return s;
  }
  async deletePlanned(id: string) { this.bundle.planned = this.bundle.planned.filter((p) => p.id !== id); }
  async addMeasurement(m: Omit<Measurement, "id" | "last_synced_at">) {
    this.bundle.measurements.push({ ...m, id: nid("meas"), last_synced_at: null });
  }
  async importMeasurements(rows: Omit<Measurement, "id" | "last_synced_at">[]) {
    const have = new Set(this.bundle.measurements.map((m) => `${m.source}|${m.external_id ?? ""}`));
    let n = 0;
    for (const r of rows) {
      const k = `${r.source}|${r.external_id ?? ""}`;
      if (have.has(k)) continue;
      have.add(k);
      this.bundle.measurements.push({ ...r, id: nid("meas"), last_synced_at: null });
      n++;
    }
    return n;
  }
  async deleteMeasurement(id: string) { this.bundle.measurements = this.bundle.measurements.filter((m) => m.id !== id); }
  async saveProfile(p: Partial<Profile>) { this.bundle.profile = { ...(this.bundle.profile as Profile), ...p }; }
  async enableConnection() { throw new Error("En modo demostración no se pueden conectar cuentas reales."); }
  async setConnectionStatus() { throw new Error("En modo demostración no se pueden conectar cuentas reales."); }
  async createPhotoEntry(e: Omit<PhotoEntry, "id" | "files">) {
    const entry: PhotoEntry = { ...e, id: nid("entry"), files: [] };
    this.bundle.photoEntries.unshift(entry);
    return entry;
  }
  async updatePhotoEntry(id: string, patch: Partial<Omit<PhotoEntry, "id" | "files">>) {
    const e = this.bundle.photoEntries.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
  }
  async deletePhotoEntry(entry: PhotoEntry) {
    for (const f of entry.files) await this.deletePhoto(f);
    this.bundle.photoEntries = this.bundle.photoEntries.filter((e) => e.id !== entry.id);
  }
  async uploadPhoto(entryId: string, pose: Pose, file: File) {
    const entry = this.bundle.photoEntries.find((e) => e.id === entryId);
    if (!entry) throw new Error("Registro no encontrado");
    const prev = entry.files.find((f) => f.pose === pose);
    if (prev) await this.deletePhoto(prev);
    const display = await makeDisplayVersion(file);
    const originalPath = `demo/${entryId}/${pose}-original`;
    this.blobs.set(originalPath, URL.createObjectURL(file));
    let displayPath: string | null = null;
    if (display) {
      displayPath = `demo/${entryId}/${pose}-display`;
      this.blobs.set(displayPath, URL.createObjectURL(display.blob));
    }
    const pf: PhotoFile = { id: nid("photo"), entry_id: entryId, pose, original_path: originalPath, display_path: displayPath,
      mime: file.type, bytes: file.size, width: display?.width ?? null, height: display?.height ?? null, framing: { scale: 1, x: 0, y: 0 } };
    entry.files.push(pf);
    return pf;
  }
  async deletePhoto(file: PhotoFile) {
    for (const p of [file.original_path, file.display_path]) {
      if (p && this.blobs.has(p)) { URL.revokeObjectURL(this.blobs.get(p) as string); this.blobs.delete(p); }
    }
    for (const e of this.bundle.photoEntries) e.files = e.files.filter((f) => f.id !== file.id);
  }
  async updateFraming(fileId: string, framing: Framing) {
    for (const e of this.bundle.photoEntries) for (const f of e.files) if (f.id === fileId) f.framing = framing;
  }
  async photoUrl(path: string) {
    const u = this.blobs.get(path);
    if (!u) throw new Error("Foto no disponible");
    return u;
  }
  async addCoachMessage(role: CoachMessage["role"], content: string, payload: CoachPayload | null = null) {
    this.bundle.coachMessages.push({ id: nid("msg"), role, content, payload, created_at: new Date().toISOString() });
  }
  async clearCoachMessages() { this.bundle.coachMessages = []; }
}
