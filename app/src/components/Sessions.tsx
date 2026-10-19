import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../data/AppData";
import { buildSession } from "../lib/coach";
import { addDays, fmtDayLong } from "../lib/dates";
import { fmtDistance, fmtDuration, fmtElevation, fmtHr, fmtNum } from "../lib/format";
import { durationOf, intensityBucket } from "../lib/metrics";
import { isBike, SPORT_ICON, SPORT_LABEL, sportColor } from "../lib/sports";
import type { Activity, Intensity, PlanCategory, PlannedDraft, PlannedSession } from "../lib/types";
import { Icon } from "./icons";
import { Field, Modal, SportChip } from "./ui";

export const STATUS_LABEL: Record<PlannedSession["status"], string> = {
  propuesta: "Sugerencia pendiente",
  planificada: "Planificada",
  completada: "Completada",
  omitida: "Omitida",
};

const INTENSITY_LABEL: Record<Intensity, string> = { suave: "Suave", moderada: "Moderada", alta: "Alta" };

export function intensityLabel(i: Intensity | null): string {
  return i ? INTENSITY_LABEL[i] : "Sin datos";
}

/** Barra de estructura: calentamiento / bloque principal / vuelta a la calma */
export function StructureBar({ session }: { session: Pick<PlannedSession, "duration_min" | "category" | "warmup" | "cooldown"> }) {
  const { theme } = useApp();
  const total = session.duration_min ?? 0;
  if (!total || session.category === "descanso") return null;
  const minsOf = (t: string | null) => Number(/^(\d+)\s*min/.exec(t ?? "")?.[1] ?? 0);
  const w = minsOf(session.warmup) || Math.round(total * 0.15);
  const c = minsOf(session.cooldown) || Math.round(total * 0.1);
  const m = Math.max(0, total - w - c);
  const color = sportColor(session.category, theme);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="structure" aria-hidden="true">
        <span style={{ width: `${(w / total) * 100}%`, background: color, opacity: 0.45 }} />
        <span style={{ width: `${(m / total) * 100}%`, background: color }} />
        <span style={{ width: `${(c / total) * 100}%`, background: color, opacity: 0.45 }} />
      </div>
      <div className="structure-legend">
        <span>Calentamiento {w} min</span><span>Bloque principal {m} min</span><span>Vuelta a la calma {c} min</span>
      </div>
    </div>
  );
}

export function SessionDetails({ s }: { s: PlannedDraft | PlannedSession }) {
  return (
    <div className="proposal" style={{ borderStyle: s.status === "propuesta" ? "dashed" : "solid" }}>
      <div className="row between">
        <div className="row"><SportChip cat={s.category} /><span className="badge">{STATUS_LABEL[s.status]}</span>
          {s.origin !== "manual" && <span className="badge estimado">{s.origin === "reglas" ? "Generada por reglas" : "Propuesta de IA"}</span>}</div>
        <span className="small muted">{fmtDayLong(s.date)}</span>
      </div>
      <h3>{s.title}</h3>
      <StructureBar session={s} />
      <dl>
        <dt>Objetivo</dt><dd>{s.objective || "Sin datos"}</dd>
        <dt>Duración</dt><dd>{s.duration_min ? `${s.duration_min} min` : "Sin datos"}</dd>
        <dt>Intensidad</dt><dd>{intensityLabel(s.intensity)}</dd>
        <dt>Lugar</dt><dd>{s.location ? s.location[0].toUpperCase() + s.location.slice(1) : "Sin datos"}</dd>
        <dt>Calentamiento</dt><dd>{s.warmup || "Sin datos"}</dd>
        <dt>Bloque principal</dt><dd>{s.main_block || "Sin datos"}</dd>
        <dt>Vuelta a la calma</dt><dd>{s.cooldown || "Sin datos"}</dd>
        {s.rationale && (<><dt>Por qué</dt><dd className="ink2">{s.rationale}</dd></>)}
        {s.notes && (<><dt>Notas</dt><dd>{s.notes}</dd></>)}
      </dl>
    </div>
  );
}

const CATS: PlanCategory[] = ["hiit", "emtb", "mtb", "run", "otro", "descanso"];

export function PlannedForm({ initial, onClose, title }: { initial: PlannedDraft; onClose: () => void; title: string }) {
  const { run, data } = useApp();
  const [s, setS] = useState<PlannedDraft>(initial);
  const set = <K extends keyof PlannedDraft>(k: K, v: PlannedDraft[K]) => setS((x) => ({ ...x, [k]: v }));
  const fillTemplate = () => {
    const tpl = buildSession(s.category, s.intensity ?? "moderada", s.duration_min ?? 45, s.date, data.profile, s.location);
    setS((x) => ({ ...x, title: x.title || tpl.title, objective: tpl.objective, warmup: tpl.warmup, main_block: tpl.main_block, cooldown: tpl.cooldown }));
  };
  const save = async (status?: PlannedSession["status"]) => {
    if (!s.title.trim()) { set("title", SPORT_LABEL[s.category]); }
    const out = await run((r) => r.savePlanned({ ...s, title: s.title.trim() || SPORT_LABEL[s.category], status: status ?? s.status }),
      s.id ? "Sesión actualizada" : "Sesión añadida al calendario");
    if (out) onClose();
  };
  const remove = async () => {
    if (!s.id || !confirm("¿Eliminar esta sesión del calendario?")) return;
    await run((r) => r.deletePlanned(s.id as string), "Sesión eliminada");
    onClose();
  };
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        {s.id && <button className="btn danger" onClick={remove}><Icon name="trash" />Eliminar</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Cancelar</button>
        {s.status === "propuesta" && <button className="btn" onClick={() => save("propuesta")}>Guardar como sugerencia</button>}
        <button className="btn primary" onClick={() => save(s.status === "propuesta" ? "planificada" : undefined)}>
          {s.status === "propuesta" ? "Añadir al calendario" : "Guardar"}
        </button>
      </>
    }>
      <div className="form-grid">
        <Field label="Fecha">
          <div className="row nowrap">
            <input className="input" type="date" value={s.date} onChange={(e) => set("date", e.target.value)} />
            <button className="btn sm" type="button" onClick={() => set("date", addDays(s.date, 1))} title="Mover un día">+1 día</button>
          </div>
        </Field>
        <Field label="Hora (opcional)">
          <input className="input" type="time" value={s.start_time ?? ""} onChange={(e) => set("start_time", e.target.value || null)} />
        </Field>
        <Field label="Deporte">
          <select className="input" value={s.category} onChange={(e) => set("category", e.target.value as PlanCategory)}>
            {CATS.map((c) => <option key={c} value={c}>{SPORT_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label="Título">
          <input className="input" value={s.title} onChange={(e) => set("title", e.target.value)} placeholder="Ej.: Fuerza en rack" />
        </Field>
        <Field label="Duración (min)">
          <input className="input" type="number" min={5} max={600} value={s.duration_min ?? ""}
            onChange={(e) => set("duration_min", e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <Field label="Intensidad">
          <select className="input" value={s.intensity ?? ""} onChange={(e) => set("intensity", (e.target.value || null) as Intensity | null)}>
            <option value="">Sin indicar</option><option value="suave">Suave</option><option value="moderada">Moderada</option><option value="alta">Alta</option>
          </select>
        </Field>
        <Field label="Lugar">
          <select className="input" value={s.location ?? ""} onChange={(e) => set("location", (e.target.value || null) as PlannedSession["location"])}>
            <option value="">Sin indicar</option><option value="casa">Casa</option><option value="gimnasio">Gimnasio</option>
            <option value="exterior">Exterior</option><option value="otro">Otro</option>
          </select>
        </Field>
        <Field label="Estado">
          <select className="input" value={s.status} onChange={(e) => set("status", e.target.value as PlannedSession["status"])}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Objetivo" full><input className="input" value={s.objective ?? ""} onChange={(e) => set("objective", e.target.value || null)} /></Field>
        <Field label="Calentamiento" full><textarea className="input" value={s.warmup ?? ""} onChange={(e) => set("warmup", e.target.value || null)} /></Field>
        <Field label="Bloque principal" full><textarea className="input" value={s.main_block ?? ""} onChange={(e) => set("main_block", e.target.value || null)} /></Field>
        <Field label="Vuelta a la calma" full><textarea className="input" value={s.cooldown ?? ""} onChange={(e) => set("cooldown", e.target.value || null)} /></Field>
        <Field label="Notas" full><textarea className="input" value={s.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} /></Field>
        <div className="full row">
          <button className="btn sm" type="button" onClick={fillTemplate}>Rellenar con plantilla explícita</button>
          <span className="small muted">Usa plantillas fijas según deporte, intensidad, duración y tu material.</span>
        </div>
      </div>
    </Modal>
  );
}

export function newDraft(date: string, category: PlanCategory = "hiit"): PlannedDraft {
  return {
    date, start_time: null, category, title: "", objective: null, warmup: null, main_block: null, cooldown: null,
    duration_min: 45, intensity: "moderada", location: category === "hiit" ? "casa" : "exterior", status: "planificada",
    origin: "manual", rationale: null, completed_activity_id: null, notes: null,
  };
}

export function ActivityMetrics({ a }: { a: Activity }) {
  const { units } = useApp();
  const parts = [fmtDuration(durationOf(a), { short: true })];
  if (a.avg_hr) parts.push(fmtHr(a.avg_hr));
  if (a.training_load !== null) parts.push(`carga ${fmtNum(a.training_load)}`);
  if (isBike(a.category) || a.category === "run") {
    if (a.distance_m) parts.push(fmtDistance(a.distance_m, units));
    if (a.elevation_gain_m) parts.push(`+${fmtElevation(a.elevation_gain_m, units)}`);
  }
  return <>{parts.join(" · ")}</>;
}

/**
 * Fila de actividad. `wodTitle`, `tags` y `pending` son opcionales (Hoy y Actividades):
 * si no se pasan, la fila se ve igual que antes.
 */
export function ActivityRow({ a, wodTitle, tags, pending }: { a: Activity; wodTitle?: string | null; tags?: string[]; pending?: string | null }) {
  const { theme } = useApp();
  const ib = intensityBucket(a);
  const c = sportColor(a.category, theme);
  return (
    <Link to={`/actividades/${a.id}`} className="list-item">
      <span className="row-icon" style={{ background: `color-mix(in srgb, ${c} 20%, transparent)`, color: c }} aria-hidden="true">
        <Icon name={SPORT_ICON[a.category]} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="t" style={{ display: "block" }}>{wodTitle || a.name || SPORT_LABEL[a.category]}</span>
        <span className="m">
          <span>{SPORT_LABEL[a.category]}</span>
          {tags?.map((t) => <span key={t} className="badge">{t}</span>)}
          {pending && <span className="pending-flag" title={pending}><Icon name="alert" />Registro pendiente</span>}
          <span>{fmtDayLong(a.local_date)}</span>
          {a.category_needs_review && <span style={{ color: "var(--warn)" }}>Revisar categoría</span>}
          {a.source === "import" && <span>Importada</span>}
        </span>
      </span>
      <span className="r">
        <ActivityMetrics a={a} />
        {ib && <span className="tiny muted" style={{ display: "block" }}>Intensidad {intensityLabel(ib).toLowerCase()}</span>}
      </span>
    </Link>
  );
}
