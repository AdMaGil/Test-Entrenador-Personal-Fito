import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, todayISO } from "../lib/dates";
import { extensionOf, makeDisplayVersion } from "../lib/photos";
import type {
  Activity, Checkin, CoachMessage, CoachPayload, DataBundle, Feedback, Framing, Measurement, ParsedImport,
  PhotoEntry, PhotoFile, PlannedDraft, PlannedSession, Pose, Profile, Sport, StrengthEntry, StrengthSet, Streams,
  Workout, WorkoutDraft, BlockResult,
} from "../lib/types";
import { validateWod } from "../lib/wod";
import type { Repo } from "./repo";

const BUCKET = "progress-photos";
const SIGNED_URL_SECONDS = 60 * 30;
const HISTORY_DAYS = 800;

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** La tabla o columna aún no existe: la migración de WOD no se ha aplicado. */
function isMissingSchema(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(err.code ?? "")
    || /does not exist|could not find the (table|.*column)/i.test(err.message ?? "");
}

/** PostgREST devuelve una relación «a uno» como objeto; se acepta también lista por compatibilidad. */
function embeddedOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

const SET_COLUMNS_V2 = "id,activity_id,exercise,set_number,reps,weight_kg,duration_s,notes,status,workout_id,block_ref,item_ref,exercise_original,load_mode,implements,load_per_implement_kg,reps_scope,distance_m,calories";
const SET_COLUMNS = "id,activity_id,exercise,set_number,reps,weight_kg,duration_s,notes,status,workout_id,block_ref,item_ref,exercise_original";
const SET_COLUMNS_LEGACY = "id,activity_id,exercise,set_number,reps,weight_kg,duration_s,notes";

/** Revalida el WOD guardado: si algo no encaja, se conserva lo legible y el resto queda como no reconocido. */
function hydrateWorkout(row: Workout): Workout {
  const v = validateWod(row.spec);
  return v.ok ? { ...row, spec: v.wod } : row;
}

export class SupabaseRepo implements Repo {
  readonly mode = "real" as const;
  private urlCache = new Map<string, { url: string; exp: number }>();
  /** Se desactiva si la base de datos todavía no tiene la migración de WOD. */
  private wodReady = true;
  /** Se desactiva si falta la migración de resultados (Entrega 2). */
  private resultsReady = true;

  constructor(private sb: SupabaseClient, private userId: string) {}

  async loadAll(): Promise<DataBundle> {
    const since = addDays(todayISO(), -HISTORY_DAYS);
    const [profile, acts, well, meas, chk, plan, fb, conn, runs, entries, files, msgs, strength] = await Promise.all([
      this.sb.from("profiles").select("*").eq("user_id", this.userId).maybeSingle(),
      this.sb.from("activities")
        .select("id,source,external_id,data_origin,start_time,local_date,name,source_type,category_auto,category_ambiguous,category_override,category,category_needs_review,duration_s,moving_time_s,distance_m,elevation_gain_m,avg_hr,max_hr,avg_speed_ms,max_speed_ms,avg_cadence,rider_avg_power_w,rider_power_source,training_load,intensity,trimp,calories,hr_zone_times_s,hr_zone_bounds,device_name,has_gps,has_heartrate,stream_types,api_restricted,last_synced_at,created_at")
        .gte("local_date", since).order("local_date", { ascending: false }).limit(3000),
      this.sb.from("wellness_daily").select("date,source,resting_hr,hrv,sleep_secs,sleep_score,sleep_quality,steps,ctl,atl,ramp_rate,last_synced_at")
        .gte("date", since).order("date"),
      this.sb.from("body_measurements").select("*").order("measured_on"),
      this.sb.from("daily_checkins").select("date,energy,fatigue,soreness,sensations").gte("date", since),
      this.sb.from("planned_sessions").select("*").gte("date", addDays(todayISO(), -365)).order("date"),
      this.sb.from("activity_feedback").select("*"),
      this.sb.from("data_connections").select("*").eq("provider", "intervals").maybeSingle(),
      this.sb.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(10),
      this.sb.from("photo_entries").select("*").order("taken_on", { ascending: false }),
      this.sb.from("photo_files").select("*"),
      this.sb.from("coach_messages").select("*").order("created_at").limit(200),
      this.loadStrength(since),
    ]);
    const workouts = await this.sb.from("workouts").select("*").order("created_at", { ascending: true }).limit(2000);
    if (workouts.error && !isMissingSchema(workouts.error)) throw new Error(workouts.error.message);
    this.wodReady = !workouts.error;
    const results = this.wodReady
      ? await this.sb.from("workout_block_results").select("workout_id,block_ref,status,personal,team,rpe,adaptations,notes").limit(5000)
      : { data: [], error: { code: "42P01", message: "sin WOD" } };
    if (results.error && !isMissingSchema(results.error)) throw new Error(results.error.message);
    this.resultsReady = this.wodReady && !results.error;
    const fileRows = must(files) as PhotoFile[];
    const photoEntries = (must(entries) as Omit<PhotoEntry, "files">[]).map((e) => ({
      ...e, files: fileRows.filter((f) => f.entry_id === e.id),
    }));
    const feedback: Record<string, Feedback> = {};
    for (const f of must(fb) as Feedback[]) feedback[f.activity_id] = f;
    type Embedded<T> = T | T[] | null;
    type StrengthRow = StrengthSet & { id: string; activities: Embedded<{ local_date: string }>; planned_sessions: Embedded<{ date: string }> };
    // Corrección: la relación «a uno» llega como objeto (antes se leía como lista y todas las series se descartaban)
    const strengthSets = (strength as unknown as StrengthRow[])
      .map(({ activities, planned_sessions, ...s }) => ({
        ...s, date: embeddedOne(activities)?.local_date ?? embeddedOne(planned_sessions)?.date ?? null,
      }))
      .filter((s): s is StrengthEntry => s.date !== null);
    return {
      profile: must(profile) as Profile | null,
      activities: must(acts) as Activity[],
      wellness: must(well) as DataBundle["wellness"],
      measurements: must(meas) as Measurement[],
      checkins: must(chk) as Checkin[],
      planned: must(plan) as PlannedSession[],
      feedback,
      connection: must(conn) as DataBundle["connection"],
      syncRuns: must(runs) as DataBundle["syncRuns"],
      photoEntries,
      coachMessages: must(msgs) as CoachMessage[],
      strengthSets,
      workouts: this.wodReady ? (workouts.data as Workout[]).map(hydrateWorkout) : [],
      wodReady: this.wodReady,
      blockResults: this.resultsReady ? (results.data as BlockResult[]) : [],
      resultsReady: this.resultsReady,
    };
  }

  /** Series con la fecha de su sesión. Si las columnas nuevas aún no existen, se leen las antiguas. */
  private async loadStrength(since: string): Promise<unknown[]> {
    const q = (cols: string) => this.sb.from("strength_sets")
      .select(`${cols},activities(local_date),planned_sessions(date)`)
      .gte("created_at", since).order("created_at", { ascending: false }).limit(3000);
    for (const cols of [SET_COLUMNS_V2, SET_COLUMNS]) {
      const res = await q(cols);
      if (!res.error) return res.data as unknown[];
      if (!isMissingSchema(res.error)) throw new Error(res.error.message);
    }
    return must(await q(SET_COLUMNS_LEGACY)) as unknown[];
  }

  async getStreams(activityId: string): Promise<Streams | null> {
    const row = must(await this.sb.from("activity_streams").select("streams").eq("activity_id", activityId).maybeSingle()) as
      | { streams: Streams } | null;
    return row?.streams ?? null;
  }

  async getStrengthSets(activityId: string): Promise<StrengthSet[]> {
    return must(await this.sb.from("strength_sets").select("*").eq("activity_id", activityId)
      .order("exercise").order("set_number")) as StrengthSet[];
  }

  async saveStrengthSets(activityId: string, sets: StrengthSet[]): Promise<void> {
    must(await this.sb.from("strength_sets").delete().eq("activity_id", activityId));
    if (!sets.length) return;
    must(await this.sb.from("strength_sets").insert(sets.map((s) => ({
      activity_id: activityId, exercise: s.exercise, set_number: s.set_number, reps: s.reps,
      weight_kg: s.weight_kg, duration_s: s.duration_s, notes: s.notes,
      ...(this.wodReady ? {
        status: s.status ?? "realizado", workout_id: s.workout_id ?? null, block_ref: s.block_ref ?? null,
        item_ref: s.item_ref ?? null, exercise_original: s.exercise_original ?? null,
      } : {}),
    }))));
  }

  async saveSession(activityId: string, payload: { feedback: Feedback | null; sets: StrengthSet[]; results: BlockResult[] }): Promise<void> {
    if (!this.resultsReady) {
      // Sin la migración de la Entrega 2: guardado anterior (no atómico), sin resultados por bloque
      if (payload.feedback) await this.saveFeedback(payload.feedback);
      await this.saveStrengthSets(activityId, payload.sets);
      return;
    }
    const fb = payload.feedback ? (({ activity_id: _a, ...rest }) => { void _a; return rest; })(payload.feedback) : null;
    const sets = payload.sets.map((s) => ({
      exercise: s.exercise, set_number: s.set_number, reps: s.reps, weight_kg: s.weight_kg, duration_s: s.duration_s,
      notes: s.notes, status: s.status ?? "realizado", workout_id: s.workout_id ?? null, block_ref: s.block_ref ?? null,
      item_ref: s.item_ref ?? null, exercise_original: s.exercise_original ?? null, load_mode: s.load_mode ?? null,
      implements: s.implements ?? null, load_per_implement_kg: s.load_per_implement_kg ?? null,
      reps_scope: s.reps_scope ?? null, distance_m: s.distance_m ?? null, calories: s.calories ?? null,
    }));
    const { error } = await this.sb.rpc("save_activity_session", {
      p_activity_id: activityId, p_feedback: fb, p_sets: sets, p_results: payload.results,
    });
    if (error) throw new Error(error.message);
  }

  private requireWod() {
    if (!this.wodReady) throw new Error("Falta aplicar la migración de WOD en la base de datos (workflow «aplicar migraciones»).");
  }

  async saveWorkout(draft: WorkoutDraft, supersede: string[] = []): Promise<Workout> {
    this.requireWod();
    const row = { ...draft, format: "adolfo-wod", format_version: 1 };
    // Idempotente: si este mismo intento ya se guardó (doble clic o reintento), no se duplica
    must(await this.sb.from("workouts").upsert(row, { onConflict: "user_id,client_ref", ignoreDuplicates: true }));
    const saved = must(await this.sb.from("workouts").select("*").eq("client_ref", draft.client_ref).single()) as Workout;
    const others = supersede.filter((id) => id !== saved.id);
    if (others.length) {
      must(await this.sb.from("workouts").update({ superseded_at: new Date().toISOString() }).in("id", others).is("superseded_at", null));
    }
    return hydrateWorkout(saved);
  }

  async updateWorkout(id: string, patch: Partial<Pick<Workout, "title" | "wod_date" | "modality" | "spec">>): Promise<void> {
    this.requireWod();
    must(await this.sb.from("workouts").update(patch).eq("id", id));
  }

  async linkWorkout(id: string, link: { activity_id: string | null; planned_session_id: string | null }): Promise<void> {
    this.requireWod();
    must(await this.sb.from("workouts").update(link).eq("id", id));
  }

  async setWorkoutArchived(id: string, archived: boolean): Promise<void> {
    this.requireWod();
    must(await this.sb.from("workouts").update({ superseded_at: archived ? new Date().toISOString() : null }).eq("id", id));
  }

  async saveFeedback(fb: Feedback): Promise<void> {
    must(await this.sb.from("activity_feedback").upsert(fb, { onConflict: "activity_id" }));
  }

  async setCategoryOverride(activityId: string, category: Sport | null): Promise<void> {
    must(await this.sb.from("activities").update({ category_override: category }).eq("id", activityId));
  }

  async importActivity(p: ParsedImport, category: Sport, name: string): Promise<string> {
    const externalId = `import:${p.startTime ?? p.fileName}`;
    const row = {
      source: "import", external_id: externalId, data_origin: "medido",
      start_time: p.startTime, local_date: p.localDate, name,
      source_type: p.sourceType, category_auto: category, category_ambiguous: false,
      duration_s: p.durationS ? Math.round(p.durationS) : null,
      moving_time_s: p.movingTimeS ? Math.round(p.movingTimeS) : null,
      distance_m: p.distanceM, elevation_gain_m: p.elevationGainM, avg_hr: p.avgHr, max_hr: p.maxHr,
      avg_speed_ms: p.avgSpeedMs, avg_cadence: p.avgCadence,
      rider_avg_power_w: p.avgPowerW, rider_power_source: p.avgPowerW ? "medidor" : null,
      calories: p.calories, has_gps: Boolean(p.streams.latlng?.length), has_heartrate: Boolean(p.streams.heartrate?.length),
      stream_types: Object.keys(p.streams),
    };
    const res = await this.sb.from("activities").insert(row).select("id").single();
    if (res.error) {
      if (res.error.code === "23505") throw new Error("Esta actividad ya estaba importada.");
      throw new Error(res.error.message);
    }
    const id = (res.data as { id: string }).id;
    if (Object.keys(p.streams).length) {
      must(await this.sb.from("activity_streams").insert({ activity_id: id, streams: p.streams }));
    }
    return id;
  }

  async deleteImportedActivity(activityId: string): Promise<void> {
    must(await this.sb.from("activities").delete().eq("id", activityId).eq("source", "import"));
  }

  async saveCheckin(c: Checkin): Promise<void> {
    must(await this.sb.from("daily_checkins").upsert(c, { onConflict: "user_id,date" }));
  }

  async savePlanned(p: PlannedDraft): Promise<PlannedSession> {
    const { id, ...rest } = p;
    const q = id
      ? this.sb.from("planned_sessions").update(rest).eq("id", id).select("*").single()
      : this.sb.from("planned_sessions").insert(rest).select("*").single();
    return must(await q) as PlannedSession;
  }

  async deletePlanned(id: string): Promise<void> {
    must(await this.sb.from("planned_sessions").delete().eq("id", id));
  }

  async addMeasurement(m: Omit<Measurement, "id" | "last_synced_at">): Promise<void> {
    must(await this.sb.from("body_measurements").insert({ ...m, external_id: null }));
  }

  async deleteMeasurement(id: string): Promise<void> {
    must(await this.sb.from("body_measurements").delete().eq("id", id).eq("source", "manual"));
  }

  async saveProfile(p: Partial<Profile>): Promise<void> {
    const { user_id: _ignored, ...rest } = p;
    void _ignored;
    const res = await this.sb.from("profiles").upsert({ user_id: this.userId, ...rest }, { onConflict: "user_id" });
    // Objetivos nuevos sin la migración aplicada: mensaje claro en lugar del error técnico
    if (res.error && /weight_goal_date|active_kcal_goal|sessions_week_goal|sleep_goal_h/.test(res.error.message ?? "")) {
      throw new Error("Falta aplicar la migración de objetivos (20261013100000_objetivos) en la base de datos.");
    }
    must(res);
  }

  async enableConnection(syncFrom: string | null): Promise<void> {
    const existing = must(await this.sb.from("data_connections").select("id").eq("provider", "intervals").maybeSingle());
    if (existing) {
      must(await this.sb.from("data_connections").update({ status: "pendiente", sync_from: syncFrom }).eq("provider", "intervals"));
    } else {
      must(await this.sb.from("data_connections").insert({ provider: "intervals", status: "pendiente", sync_from: syncFrom }));
    }
  }

  async setConnectionStatus(status: "pendiente" | "desactivada"): Promise<void> {
    must(await this.sb.from("data_connections").update({ status }).eq("provider", "intervals"));
  }

  async createPhotoEntry(e: Omit<PhotoEntry, "id" | "files">): Promise<PhotoEntry> {
    const row = must(await this.sb.from("photo_entries").insert(e).select("*").single()) as Omit<PhotoEntry, "files">;
    return { ...row, files: [] };
  }

  async updatePhotoEntry(id: string, patch: Partial<Omit<PhotoEntry, "id" | "files">>): Promise<void> {
    must(await this.sb.from("photo_entries").update(patch).eq("id", id));
  }

  async deletePhotoEntry(entry: PhotoEntry): Promise<void> {
    // Primero los archivos: si fallan, el registro se conserva y no quedan huérfanos
    const paths = entry.files.flatMap((f) => [f.original_path, f.display_path].filter(Boolean) as string[]);
    if (paths.length) must(await this.sb.storage.from(BUCKET).remove(paths));
    must(await this.sb.from("photo_entries").delete().eq("id", entry.id));
  }

  async uploadPhoto(entryId: string, pose: Pose, file: File): Promise<PhotoFile> {
    const stamp = Date.now();
    const base = `${this.userId}/${entryId}/${pose}-${stamp}`;
    const originalPath = `${base}-original.${extensionOf(file)}`;
    must(await this.sb.storage.from(BUCKET).upload(originalPath, file, { contentType: file.type || undefined, upsert: false }));
    const display = await makeDisplayVersion(file);
    let displayPath: string | null = null;
    if (display) {
      displayPath = `${base}-display.jpg`;
      const up = await this.sb.storage.from(BUCKET).upload(displayPath, display.blob, { contentType: "image/jpeg" });
      if (up.error) displayPath = null;
    }
    // Sustituye la foto anterior de la misma pose
    const previous = must(await this.sb.from("photo_files").select("*").eq("entry_id", entryId).eq("pose", pose).maybeSingle()) as PhotoFile | null;
    if (previous) await this.deletePhoto(previous);
    return must(await this.sb.from("photo_files").insert({
      entry_id: entryId, pose, original_path: originalPath, display_path: displayPath,
      mime: file.type || null, bytes: file.size, width: display?.width ?? null, height: display?.height ?? null,
    }).select("*").single()) as PhotoFile;
  }

  async deletePhoto(file: PhotoFile): Promise<void> {
    const paths = [file.original_path, file.display_path].filter(Boolean) as string[];
    must(await this.sb.storage.from(BUCKET).remove(paths));
    must(await this.sb.from("photo_files").delete().eq("id", file.id));
  }

  async updateFraming(fileId: string, framing: Framing): Promise<void> {
    must(await this.sb.from("photo_files").update({ framing }).eq("id", fileId));
  }

  async photoUrl(path: string, opts: { download?: string } = {}): Promise<string> {
    const key = `${path}|${opts.download ?? ""}`;
    const hit = this.urlCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.url;
    const res = await this.sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS,
      opts.download ? { download: opts.download } : undefined);
    if (res.error || !res.data) throw new Error(res.error?.message ?? "No se pudo generar el enlace temporal");
    this.urlCache.set(key, { url: res.data.signedUrl, exp: Date.now() + (SIGNED_URL_SECONDS - 60) * 1000 });
    return res.data.signedUrl;
  }

  async addCoachMessage(role: CoachMessage["role"], content: string, payload: CoachPayload | null = null): Promise<void> {
    must(await this.sb.from("coach_messages").insert({ role, content, payload }));
  }

  async clearCoachMessages(): Promise<void> {
    must(await this.sb.from("coach_messages").delete().eq("user_id", this.userId));
  }
}
