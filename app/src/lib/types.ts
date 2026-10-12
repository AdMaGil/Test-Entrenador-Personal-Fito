import type { WodSpec } from "./wod";

export type Sport = "hiit" | "emtb" | "mtb" | "run" | "otro";
export type PlanCategory = Sport | "descanso";
export type Intensity = "suave" | "moderada" | "alta";
export type Pose = "frontal" | "perfil" | "espalda";

export interface Activity {
  id: string;
  source: "intervals" | "import" | "manual";
  external_id: string;
  data_origin: "medido" | "estimado" | "manual";
  start_time: string | null;
  local_date: string;
  name: string | null;
  source_type: string | null;
  category_auto: Sport;
  category_ambiguous: boolean;
  category_override: Sport | null;
  category: Sport;
  category_needs_review: boolean;
  duration_s: number | null;
  moving_time_s: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_speed_ms: number | null;
  max_speed_ms: number | null;
  avg_cadence: number | null;
  rider_avg_power_w: number | null;
  rider_power_source: "medidor" | "estimado" | null;
  training_load: number | null;
  intensity: number | null;
  trimp: number | null;
  calories: number | null;
  hr_zone_times_s: number[] | null;
  hr_zone_bounds: number[] | null;
  device_name: string | null;
  has_gps: boolean | null;
  has_heartrate: boolean | null;
  stream_types: string[] | null;
  api_restricted: boolean;
  last_synced_at: string | null;
  created_at?: string;
}

export interface Streams {
  time?: number[];
  heartrate?: number[];
  altitude?: number[];
  latlng?: [number, number][];
  velocity_smooth?: number[];
  cadence?: number[];
  watts?: number[];
  distance?: number[];
}

export interface Feedback {
  activity_id: string;
  rpe: number | null;
  sensations: string | null;
  notes: string | null;
  terrain_notes: string | null;
  ebike_battery_start_pct: number | null;
  ebike_battery_end_pct: number | null;
  ebike_assist_notes: string | null;
}

export interface Wellness {
  date: string;
  source: string;
  resting_hr: number | null;
  hrv: number | null;
  sleep_secs: number | null;
  sleep_score: number | null;
  sleep_quality: number | null;
  steps: number | null;
  ctl: number | null;
  atl: number | null;
  ramp_rate: number | null;
  last_synced_at: string | null;
}

export interface Measurement {
  id: string;
  source: "intervals" | "manual";
  measured_on: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  waist_cm: number | null;
  data_origin: "medido" | "manual";
  notes: string | null;
  last_synced_at: string | null;
}

export interface Checkin {
  date: string;
  energy: number | null;
  fatigue: number | null;
  soreness: string[];
  sensations: string | null;
}

export interface PlannedSession {
  id: string;
  date: string;
  start_time: string | null;
  category: PlanCategory;
  title: string;
  objective: string | null;
  warmup: string | null;
  main_block: string | null;
  cooldown: string | null;
  duration_min: number | null;
  intensity: Intensity | null;
  location: "casa" | "gimnasio" | "exterior" | "otro" | null;
  status: "propuesta" | "planificada" | "completada" | "omitida";
  origin: "manual" | "reglas" | "ia";
  rationale: string | null;
  completed_activity_id: string | null;
  notes: string | null;
}

export type PlannedDraft = Omit<PlannedSession, "id"> & { id?: string };

export interface StrengthSet {
  id?: string;
  exercise: string;
  set_number: number;
  reps: number | null;
  weight_kg: number | null;
  duration_s: number | null;
  notes: string | null;
  /** «pendiente» = falta un dato (p. ej. el peso venía como «revisar»). Ausente en filas antiguas = realizado. */
  status?: "realizado" | "pendiente";
  /** Enlace opcional con el WOD importado y su bloque/ejercicio. */
  workout_id?: string | null;
  block_ref?: string | null;
  item_ref?: string | null;
  /** Nombre tal como llegó al importar, si después se corrige la asociación. */
  exercise_original?: string | null;
  /**
   * Interpretación de la carga. NULL = sin aclarar (series antiguas): no se reinterpreta.
   * weight_kg es la carga externa TOTAL cuando load_mode es «total» o «por_implemento».
   */
  load_mode?: LoadMode | null;
  implements?: number | null;
  load_per_implement_kg?: number | null;
  reps_scope?: "total" | "por_lado" | null;
  distance_m?: number | null;
  calories?: number | null;
}

export type LoadMode = "total" | "por_implemento" | "sin_carga";

/** Métricas de resultado de un bloque. NULL = desconocido. */
export interface ResultMetrics {
  time_s?: number | null;
  rounds?: number | null;
  reps?: number | null;
  calories?: number | null;
  distance_m?: number | null;
}

/** Lo realizado en un bloque del WOD (separado de lo previsto). status NULL = pendiente. */
export interface BlockResult {
  workout_id: string;
  block_ref: string;
  status: "realizado" | "no_realizado" | null;
  /** En parejas: mi contribución (vacía = desconocida). En individual: mi resultado. */
  personal: ResultMetrics;
  /** Solo en parejas: resultado del equipo. Nunca se reparte automáticamente. */
  team: ResultMetrics;
  rpe: number | null;
  adaptations: string | null;
  notes: string | null;
}

/** WOD importado: describe el entrenamiento PREVISTO, no lo realizado. */
export interface Workout {
  id: string;
  client_ref: string;
  activity_id: string | null;
  planned_session_id: string | null;
  title: string | null;
  wod_date: string | null;
  modality: "individual" | "parejas" | null;
  spec: WodSpec;
  source_text: string | null;
  superseded_at: string | null;
  created_at: string;
}

export type WorkoutDraft = Pick<Workout, "client_ref" | "activity_id" | "planned_session_id" | "title" | "wod_date" | "modality" | "spec" | "source_text">;

/** Una serie de fuerza con la fecha de la sesión a la que pertenece (actividad o sesión planificada). */
export interface StrengthEntry extends StrengthSet {
  id: string;
  date: string;
}

export interface Units {
  weight: "kg" | "lb";
  distance: "km" | "mi";
  elevation: "m" | "ft";
}

export interface Profile {
  user_id: string;
  display_name: string | null;
  timezone: string;
  units: Units;
  theme: "dark" | "light" | "system";
  goals: string | null;
  weight_goal_kg: number | null;
  hr_max_bpm: number | null;
  available_days: number[];
  session_minutes_default: number | null;
  sport_priority: Sport[];
  equipment: string[];
  limitations: string | null;
  preferences: string | null;
}

export interface Connection {
  id: string;
  provider: "intervals";
  status: "pendiente" | "activa" | "parcial" | "error" | "desactivada";
  sync_from: string | null;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

export interface SyncRun {
  id: string;
  mode: "inicial" | "incremental" | null;
  started_at: string;
  finished_at: string | null;
  status: "en_curso" | "ok" | "parcial" | "error";
  activities_upserted: number;
  streams_fetched: number;
  wellness_upserted: number;
  measurements_upserted: number;
  warnings: string[];
  error: string | null;
}

export interface Framing {
  scale: number;
  x: number;
  y: number;
}

export interface PhotoFile {
  id: string;
  entry_id: string;
  pose: Pose;
  original_path: string;
  display_path: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  framing: Framing;
}

export interface PhotoEntry {
  id: string;
  taken_on: string;
  weight_kg: number | null;
  weight_measurement_id: string | null;
  weight_is_manual: boolean;
  waist_cm: number | null;
  notes: string | null;
  files: PhotoFile[];
}

export interface CoachMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload: CoachPayload | null;
  created_at: string;
}

export interface CoachPayload {
  proposals?: PlannedDraft[];
  changes?: { id: string; from: string; to: string; title: string }[];
  rule?: string;
  data_used?: string[];
}

export interface DataBundle {
  profile: Profile | null;
  activities: Activity[];
  wellness: Wellness[];
  measurements: Measurement[];
  checkins: Checkin[];
  planned: PlannedSession[];
  feedback: Record<string, Feedback>;
  connection: Connection | null;
  syncRuns: SyncRun[];
  photoEntries: PhotoEntry[];
  coachMessages: CoachMessage[];
  strengthSets: StrengthEntry[];
  workouts: Workout[];
  blockResults: BlockResult[];
  /** false si la migración de resultados (Entrega 2) aún no está aplicada. */
  resultsReady: boolean;
  /** false si la base de datos aún no tiene la migración de WOD aplicada (la app sigue funcionando sin esa parte). */
  wodReady: boolean;
}

export interface ParsedImport {
  fileName: string;
  format: "fit" | "gpx" | "tcx";
  startTime: string | null;
  localDate: string;
  suggested: Sport;
  suggestedReason: string;
  sourceType: string | null;
  durationS: number | null;
  movingTimeS: number | null;
  distanceM: number | null;
  elevationGainM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeedMs: number | null;
  avgCadence: number | null;
  avgPowerW: number | null;
  calories: number | null;
  streams: Streams;
}
