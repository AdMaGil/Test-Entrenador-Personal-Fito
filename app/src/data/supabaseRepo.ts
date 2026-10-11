import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, todayISO } from "../lib/dates";
import { extensionOf, makeDisplayVersion } from "../lib/photos";
import type {
  Activity, Checkin, CoachMessage, CoachPayload, DataBundle, Feedback, Framing, Measurement, ParsedImport,
  PhotoEntry, PhotoFile, PlannedDraft, PlannedSession, Pose, Profile, Sport, StrengthSet, Streams,
} from "../lib/types";
import type { Repo } from "./repo";

const BUCKET = "progress-photos";
const SIGNED_URL_SECONDS = 60 * 30;
const HISTORY_DAYS = 800;

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export class SupabaseRepo implements Repo {
  readonly mode = "real" as const;
  private urlCache = new Map<string, { url: string; exp: number }>();

  constructor(private sb: SupabaseClient, private userId: string) {}

  async loadAll(): Promise<DataBundle> {
    const since = addDays(todayISO(), -HISTORY_DAYS);
    const [profile, acts, well, meas, chk, plan, fb, conn, runs, entries, files, msgs] = await Promise.all([
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
    ]);
    const fileRows = must(files) as PhotoFile[];
    const photoEntries = (must(entries) as Omit<PhotoEntry, "files">[]).map((e) => ({
      ...e, files: fileRows.filter((f) => f.entry_id === e.id),
    }));
    const feedback: Record<string, Feedback> = {};
    for (const f of must(fb) as Feedback[]) feedback[f.activity_id] = f;
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
    };
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
    }))));
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
    must(await this.sb.from("profiles").upsert({ user_id: this.userId, ...rest }, { onConflict: "user_id" }));
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
