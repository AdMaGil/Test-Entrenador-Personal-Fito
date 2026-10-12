import type {
  Checkin, CoachMessage, CoachPayload, DataBundle, Feedback, Framing, Measurement, ParsedImport, PhotoEntry,
  PhotoFile, PlannedDraft, PlannedSession, Pose, Profile, Sport, StrengthSet, Streams,
} from "../lib/types";

/**
 * Contrato de acceso a datos. Existen dos implementaciones:
 *   - SupabaseRepo: datos reales del usuario autenticado.
 *   - DemoRepo: datos de demostración en memoria, nunca guardados en la base de datos.
 */
export interface Repo {
  readonly mode: "real" | "demo";
  loadAll(): Promise<DataBundle>;

  getStreams(activityId: string): Promise<Streams | null>;
  getStrengthSets(activityId: string): Promise<StrengthSet[]>;
  saveStrengthSets(activityId: string, sets: StrengthSet[]): Promise<void>;
  saveFeedback(fb: Feedback): Promise<void>;
  setCategoryOverride(activityId: string, category: Sport | null): Promise<void>;
  importActivity(parsed: ParsedImport, category: Sport, name: string): Promise<string>;
  deleteImportedActivity(activityId: string): Promise<void>;

  saveCheckin(c: Checkin): Promise<void>;
  savePlanned(p: PlannedDraft): Promise<PlannedSession>;
  deletePlanned(id: string): Promise<void>;

  addMeasurement(m: Omit<Measurement, "id" | "last_synced_at">): Promise<void>;
  /** Importa mediciones de Feelfit. Idempotente por external_id: reimportar no duplica. Devuelve las insertadas. */
  importMeasurements(rows: Omit<Measurement, "id" | "last_synced_at">[]): Promise<number>;
  deleteMeasurement(id: string): Promise<void>;

  saveProfile(p: Partial<Profile>): Promise<void>;
  enableConnection(syncFrom: string | null): Promise<void>;
  setConnectionStatus(status: "pendiente" | "desactivada"): Promise<void>;

  createPhotoEntry(e: Omit<PhotoEntry, "id" | "files">): Promise<PhotoEntry>;
  updatePhotoEntry(id: string, patch: Partial<Omit<PhotoEntry, "id" | "files">>): Promise<void>;
  deletePhotoEntry(entry: PhotoEntry): Promise<void>;
  uploadPhoto(entryId: string, pose: Pose, file: File): Promise<PhotoFile>;
  deletePhoto(file: PhotoFile): Promise<void>;
  updateFraming(fileId: string, framing: Framing): Promise<void>;
  photoUrl(path: string, opts?: { download?: string }): Promise<string>;

  addCoachMessage(role: CoachMessage["role"], content: string, payload?: CoachPayload | null): Promise<void>;
  clearCoachMessages(): Promise<void>;
}

export const EMPTY_BUNDLE: DataBundle = {
  profile: null, activities: [], wellness: [], measurements: [], checkins: [], planned: [], feedback: {},
  connection: null, syncRuns: [], photoEntries: [], coachMessages: [], strengthSets: [],
};
