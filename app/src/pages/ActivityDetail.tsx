import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { ElevationChart, HrChart, ZoneBars } from "../components/charts";
import { Icon } from "../components/icons";
import { intensityLabel } from "../components/Sessions";
import { BlockResultForm, ExerciseLog, SaveBar, type LocalSet, type SaveState } from "../components/SessionLog";
import { Card, Field, Modal, OriginBadge, Segmented, SportChip, Stat, Empty } from "../components/ui";
import { PendingFlag, WodBlockCard, WodEditor, WodExtras, WodSummaryLine } from "../components/Wod";
import { WodImportModal } from "../components/WodImport";
import { useApp } from "../data/AppData";
import { fmtDateTime, fmtDay, fmtDayLong, fmtTime } from "../lib/dates";
import {
  fmtClock, fmtDistance, fmtDuration, fmtElevation, fmtHr, fmtNum, fmtPace, fmtSpeed, isNum,
} from "../lib/format";
import { normalizeSetForSave } from "../lib/loads";
import { canonicalName, describeSet, exerciseCatalog, exerciseKey, lastTime } from "../lib/exercises";
import { durationOf, intensityBucket, similarSessions } from "../lib/metrics";
import {
  duplicateSet, emptyResult, isResultTouched, newSetFor, nextSetNumber, normalizeResultForSave, resultKey,
} from "../lib/session";
import { isBike, SPORT_DESCRIPTION, SPORT_LABEL, SPORTS, sourceTypeLabel, sportColor } from "../lib/sports";
import type { Activity, BlockResult, Feedback, Sport, StrengthSet, Streams, Workout } from "../lib/types";
import type { WodItem, WodSpec } from "../lib/wod";

const MapView = lazy(() => import("../components/MapView"));

function splitsPerKm(s: Streams): { km: number; secs: number }[] {
  if (!s.distance || !s.time || s.distance.length !== s.time.length) return [];
  const out: { km: number; secs: number }[] = [];
  let next = 1000, lastT = 0;
  for (let i = 0; i < s.distance.length; i++) {
    if (s.distance[i] >= next) {
      out.push({ km: next / 1000, secs: s.time[i] - lastT });
      lastT = s.time[i];
      next += 1000;
    }
  }
  return out;
}

function emptyFeedback(activityId: string): Feedback {
  return {
    activity_id: activityId, rpe: null, sensations: null, notes: null, terrain_notes: null,
    ebike_battery_start_pct: null, ebike_battery_end_pct: null, ebike_assist_notes: null,
  };
}

function FeedbackForm({ a, f, setF, hasExisting }: { a: Activity; f: Feedback; setF: (f: Feedback) => void; hasExisting: boolean }) {
  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <Card title="Tu sesión: esfuerzo y notas" action={hasExisting ? <OriginBadge origin="manual" /> : null}>
      <div className="form-grid">
        <Field label="RPE real de la sesión (1–10)" full>
          <div className="scale" style={{ gridTemplateColumns: "repeat(10, 1fr)" }} role="radiogroup" aria-label="RPE">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" aria-pressed={f.rpe === n} onClick={() => setF({ ...f, rpe: f.rpe === n ? null : n })}>{n}</button>
            ))}
          </div>
        </Field>
        <Field label="Sensaciones" full><textarea className="input" value={f.sensations ?? ""} onChange={(e) => setF({ ...f, sensations: e.target.value || null })} /></Field>
        {isBike(a.category) && (
          <Field label="Terreno y condiciones" full><input className="input" value={f.terrain_notes ?? ""} onChange={(e) => setF({ ...f, terrain_notes: e.target.value || null })} /></Field>
        )}
        {a.category === "emtb" && (
          <>
            <Field label="Batería al salir (%)" hint="Registro manual"><input className="input" type="number" min={0} max={100} value={f.ebike_battery_start_pct ?? ""} onChange={(e) => setF({ ...f, ebike_battery_start_pct: num(e.target.value) })} /></Field>
            <Field label="Batería al llegar (%)" hint="Registro manual"><input className="input" type="number" min={0} max={100} value={f.ebike_battery_end_pct ?? ""} onChange={(e) => setF({ ...f, ebike_battery_end_pct: num(e.target.value) })} /></Field>
            <Field label="Modos de asistencia usados" full><input className="input" value={f.ebike_assist_notes ?? ""} onChange={(e) => setF({ ...f, ebike_assist_notes: e.target.value || null })} placeholder="Ej.: Eco en llano, Trail en subidas" /></Field>
          </>
        )}
        <Field label="Notas" full><textarea className="input" value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value || null })} /></Field>
      </div>
    </Card>
  );
}

function Compare({ a }: { a: Activity }) {
  const { data, units } = useApp();
  const sim = similarSessions(data.activities, a, 6);
  const rows = [a, ...sim];
  const bike = isBike(a.category);
  return (
    <Card title={`Comparar con sesiones de ${SPORT_LABEL[a.category]}`}>
      {sim.length ? (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Fecha</th><th className="n">Duración</th><th className="n">FC media</th><th className="n">Carga</th>
                {(bike || a.category === "run") && <><th className="n">Distancia</th><th className="n">Desnivel</th></>}
                {a.category === "run" && <th className="n">Ritmo</th>}
                <th className="n">Z1–Z2</th><th className="n">RPE</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const z = r.hr_zone_times_s;
                  const tot = z?.reduce((x, y) => x + y, 0) ?? 0;
                  const low = z && tot ? ((z[0] + (z[1] ?? 0)) / tot) * 100 : null;
                  return (
                    <tr key={r.id} style={r.id === a.id ? { background: "var(--surface-2)" } : undefined}>
                      <td>{r.id === a.id ? <b>Esta sesión</b> : <Link to={`/actividades/${r.id}`}>{fmtDay(r.local_date)} {r.local_date.slice(0, 4)}</Link>}</td>
                      <td className="n">{fmtDuration(durationOf(r), { short: true })}</td>
                      <td className="n">{fmtHr(r.avg_hr)}</td>
                      <td className="n">{fmtNum(r.training_load)}</td>
                      {(bike || a.category === "run") && <><td className="n">{fmtDistance(r.distance_m, units)}</td><td className="n">{fmtElevation(r.elevation_gain_m, units)}</td></>}
                      {a.category === "run" && <td className="n">{fmtPace(r.avg_speed_ms, units)}</td>}
                      <td className="n">{low !== null ? `${fmtNum(low)} %` : "Sin datos"}</td>
                      <td className="n">{data.feedback[r.id]?.rpe ?? "Sin datos"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {a.category === "emtb" && <p className="chart-note">En e-MTB, más velocidad o distancia no indica por sí sola una mejora física: depende de la asistencia. Compara frecuencia cardiaca, tiempo en zonas y esfuerzo percibido.</p>}
          {a.category === "hiit" && <p className="chart-note">En HIIT, compara también el esfuerzo percibido y el trabajo registrado (series y pesos), no solo la frecuencia cardiaca.</p>}
        </>
      ) : <p className="small muted">No hay otras sesiones de {SPORT_LABEL[a.category]} para comparar todavía.</p>}
    </Card>
  );
}

function WodEditModal({ w, onClose }: { w: Workout; onClose: () => void }) {
  const { repo, refresh, notify } = useApp();
  const [spec, setSpec] = useState<WodSpec>(w.spec);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!repo || saving) return;
    setSaving(true); setError(null);
    try {
      await repo.updateWorkout(w.id, { spec, title: spec.nombre, wod_date: spec.fecha, modality: spec.modalidad });
      await refresh();
      notify("WOD actualizado");
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title="Editar WOD" onClose={() => !saving && onClose()} wide footer={<>
      <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn primary" onClick={save} disabled={saving} aria-busy={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button>
    </>}>
      <WodEditor value={spec} onChange={setSpec} />
      {error && <div className="form-error" role="alert" style={{ marginTop: 12 }}><p>No se ha podido guardar: {error}</p><p className="muted">Tus cambios siguen aquí; puedes reintentar.</p></div>}
    </Modal>
  );
}


let keySeq = 0;
const toLocal = (sets: StrengthSet[]): LocalSet[] => sets.map((s) => ({ ...s, _k: `k${++keySeq}` }));
const strip = (sets: LocalSet[]): StrengthSet[] => sets.map(({ _k, id: _id, ...rest }) => { void _k; void _id; return rest; });
const groupKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** WOD importados sin actividad y WOD archivados: vincular o restaurar (nunca automático). */
function WodLinkTools({ a }: { a: Activity }) {
  const { data, run } = useApp();
  const [linkId, setLinkId] = useState("");
  const archived = data.workouts.filter((w) => w.activity_id === a.id && w.superseded_at);
  const plannedForThis = new Set(data.planned.filter((p) => p.completed_activity_id === a.id).map((p) => p.id));
  const candidates = data.workouts
    .filter((w) => !w.superseded_at && !w.activity_id)
    .sort((x, y) => Number(plannedForThis.has(y.planned_session_id ?? "")) - Number(plannedForThis.has(x.planned_session_id ?? ""))
      || Number(y.wod_date === a.local_date) - Number(x.wod_date === a.local_date) || y.created_at.localeCompare(x.created_at));
  if (!candidates.length && !archived.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {candidates.length > 0 && (
        <Card pad>
          <div className="stack" style={{ gap: 8 }}>
            <span className="small ink2">Hay {candidates.length} WOD importado(s) sin actividad. Si alguno corresponde a esta sesión, vincúlalo:</span>
            <div className="row nowrap">
              <select className="input" value={linkId} onChange={(e) => setLinkId(e.target.value)} aria-label="WOD para vincular">
                <option value="">Elige un WOD…</option>
                {candidates.map((w) => <option key={w.id} value={w.id}>{w.title ?? "Sin nombre"}{w.wod_date ? ` · ${fmtDay(w.wod_date)}` : ""}{plannedForThis.has(w.planned_session_id ?? "") ? " · de la sesión planificada de esta actividad" : ""}</option>)}
              </select>
              <button className="btn" disabled={!linkId} onClick={async () => {
                const w = candidates.find((x) => x.id === linkId);
                if (!w) return;
                await run((r) => r.linkWorkout(w.id, { activity_id: a.id, planned_session_id: w.planned_session_id }), "WOD vinculado a esta actividad");
                setLinkId("");
              }}>Vincular</button>
            </div>
          </div>
        </Card>
      )}
      {archived.length > 0 && (
        <details className="disclosure">
          <summary><Icon name="chevron" className="ico chev" />WOD archivados ({archived.length})</summary>
          <div className="stack" style={{ gap: 6, paddingBottom: 10 }}>
            {archived.map((w) => (
              <div key={w.id} className="row between">
                <span className="small">{w.title ?? "Sin nombre"} <span className="muted">· importado el {fmtDay(w.created_at.slice(0, 10))}</span></span>
                <button className="btn ghost sm" onClick={() => run((r) => r.setWorkoutArchived(w.id, false), "WOD restaurado")}>Restaurar</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** Referencia «Última vez»: se muestra, pero nunca se registra como resultado actual. */
function LastTimeRef({ exercise, a }: { exercise: string; a: Activity }) {
  const { data } = useApp();
  const key = exerciseKey(exercise);
  if (!key) return null;
  const last = lastTime(data.strengthSets, key, { activityId: a.id, date: a.local_date });
  if (!last) return <span className="ref-line">Primer registro de este ejercicio</span>;
  return (
    <span className="ref-line">
      <span className="tag-ref">Última vez</span>
      {last.activityId ? <Link to={`/actividades/${last.activityId}`}>{fmtDay(last.date)}</Link> : fmtDay(last.date)}
      {": "}{last.sets.map(describeSet).join(" ; ")}
      {last.ambiguous && <> <PendingFlag>histórico con carga sin aclarar</PendingFlag></>}
    </span>
  );
}

/** Corrige a qué ejercicio del histórico se asocia un ejercicio importado (sin fusionar nada automáticamente). */
function AssocEditor({ original, current, catalog, onChange }: {
  original: string; current: string; catalog: { key: string; name: string }[]; onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = `cat-${exerciseKey(original).replace(/[^a-z0-9]/g, "-")}`;
  if (!open) {
    return (
      <span className="row" style={{ gap: 6 }}>
        {current !== original && <span className="tiny muted">Importado como «{original}»</span>}
        <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>Cambiar ejercicio asociado</button>
      </span>
    );
  }
  return (
    <span className="row nowrap" style={{ gap: 6 }}>
      <input className="input" list={listId} defaultValue={current} aria-label="Ejercicio asociado" autoFocus
        onKeyDown={(e) => { if (e.key === "Enter") { onChange((e.target as HTMLInputElement).value); setOpen(false); } }}
        onBlur={(e) => { onChange(e.target.value); setOpen(false); }} />
      <datalist id={listId}>{catalog.map((c) => <option key={c.key} value={c.name} />)}</datalist>
    </span>
  );
}

type Tab = "registro" | "reloj";

export default function ActivityDetail() {
  const { id } = useParams();
  const { data, repo, run, refresh, theme, units, tz, mode } = useApp();
  const nav = useNavigate();
  const a = data.activities.find((x) => x.id === id);
  const [tab, setTab] = useState<Tab>("registro");
  const [streams, setStreams] = useState<Streams | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [editingWod, setEditingWod] = useState<Workout | null>(null);

  // Estado editable y su referencia guardada (para saber si hay cambios y poder descartarlos)
  const [sets, setSets] = useState<LocalSet[] | null>(null);
  const [f, setF] = useState<Feedback | null>(null);
  const [results, setResults] = useState<Record<string, BlockResult>>({});
  const base = useRef<{ sets: string; f: string; results: string }>({ sets: "", f: "", results: "" });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);

  const activeWods = useMemo(() => (a ? data.workouts.filter((w) => w.activity_id === a.id && !w.superseded_at) : []), [data.workouts, a]);
  const serverResults = useMemo(() => {
    const out: Record<string, BlockResult> = {};
    for (const r of data.blockResults) if (activeWods.some((w) => w.id === r.workout_id)) out[resultKey(r)] = r;
    return out;
  }, [data.blockResults, activeWods]);

  const snapshot = (s: LocalSet[] | null, fb: Feedback | null, r: Record<string, BlockResult>) => ({
    sets: JSON.stringify(s ? strip(s) : null), f: JSON.stringify(fb), results: JSON.stringify(Object.values(r).filter(isResultTouched)),
  });
  const dirty = sets !== null && f !== null && (() => {
    const now = snapshot(sets, f, results);
    return now.sets !== base.current.sets || now.f !== base.current.f || now.results !== base.current.results;
  })();

  const loadSets = useCallback(async (activityId: string) => {
    if (!repo) return [];
    try { return toLocal(await repo.getStrengthSets(activityId)); } catch { return toLocal([]); }
  }, [repo]);

  // Carga inicial al cambiar de actividad
  useEffect(() => {
    if (!a || !repo) return;
    let alive = true;
    setStreams(undefined);
    repo.getStreams(a.id).then((x) => alive && setStreams(x)).catch(() => alive && setStreams(null));
    setSets(null); setSaveState("idle"); setUndo(null);
    loadSets(a.id).then((s) => {
      if (!alive) return;
      const fb = data.feedback[a.id] ?? emptyFeedback(a.id);
      setSets(s); setF(fb); setResults(serverResults);
      base.current = snapshot(s, fb, serverResults);
    });
    return () => { alive = false; };
  }, [a?.id, repo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si cambian los datos del servidor y no hay cambios locales, se sincroniza (nunca pisa lo que estás editando)
  useEffect(() => {
    if (!a || sets === null || dirty) return;
    const fb = data.feedback[a.id] ?? emptyFeedback(a.id);
    setF(fb); setResults(serverResults);
    base.current = { ...base.current, ...(() => { const sn = snapshot(sets, fb, serverResults); return { f: sn.f, results: sn.results }; })() };
  }, [data.feedback, serverResults]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (saveState === "saving" || saveState === "error") return;
    if (dirty && saveState !== "dirty") setSaveState("dirty");
    if (!dirty && saveState === "dirty") setSaveState("idle");
  }, [dirty, saveState]);

  // Protección al salir con cambios pendientes
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const splits = useMemo(() => (streams && a?.category === "run" ? splitsPerKm(streams) : []), [streams, a?.category]);

  if (!a) return <Empty title="Actividad no encontrada" action={<Link className="btn" to="/actividades">Volver a actividades</Link>} />;

  // ---------------- edición de series ----------------
  const patchSet = (k: string, patch: Partial<StrengthSet>) => setSets((cur) => cur && cur.map((s) => (s._k === k ? { ...s, ...patch } : s)));
  const removeSet = (k: string) => setSets((cur) => {
    if (!cur) return cur;
    const i = cur.findIndex((s) => s._k === k);
    if (i < 0) return cur;
    const removed = cur[i];
    setUndo({ label: `Serie ${removed.set_number} de «${removed.exercise || "ejercicio"}» quitada`, run: () => {
      setSets((c) => c && [...c.slice(0, i), removed, ...c.slice(i)]);
      setUndo(null);
    } });
    return cur.filter((s) => s._k !== k);
  });
  const duplicate = (k: string) => setSets((cur) => {
    if (!cur) return cur;
    const i = cur.findIndex((s) => s._k === k);
    const src = cur[i];
    const n = nextSetNumber(cur, (x) => x.exercise === src.exercise && x.item_ref === src.item_ref && x.workout_id === src.workout_id);
    const copy: LocalSet = { ...duplicateSet(src, n), _k: `k${++keySeq}` };
    return [...cur.slice(0, i + 1), copy, ...cur.slice(i + 1)];
  });
  const addSetFor = (w: Workout | null, blockRef: string | null, item: WodItem | null, exercise?: string) => setSets((cur) => {
    if (!cur) return cur;
    const match = (x: StrengthSet) => (item ? x.workout_id === w?.id && x.item_ref === item.id : groupKey(x.exercise) === groupKey(exercise ?? ""));
    const same = cur.filter(match);
    const last = same[same.length - 1];
    const n = nextSetNumber(cur, match);
    // Sin copiar resultados: se repite solo la interpretación de la carga de la serie anterior
    const fresh: LocalSet = last
      ? { ...duplicateSet(last, n), reps: null, duration_s: null, distance_m: null, calories: null, notes: null,
          weight_kg: last.load_mode === "total" ? null : last.weight_kg, load_per_implement_kg: null, status: "realizado", _k: `k${++keySeq}` }
      : { ...newSetFor(item, { workoutId: w?.id ?? null, blockRef, setNumber: n, exercise: exercise ?? same[0]?.exercise }), _k: `k${++keySeq}` };
    if (last && last.load_mode == null) { fresh.load_mode = "total"; fresh.weight_kg = null; }
    const idx = cur.lastIndexOf(last as LocalSet);
    return idx >= 0 ? [...cur.slice(0, idx + 1), fresh, ...cur.slice(idx + 1)] : [...cur, fresh];
  });
  const renameGroup = (oldKey: string, name: string) => setSets((cur) => cur && cur.map((s) => (!s.item_ref && groupKey(s.exercise) === oldKey ? { ...s, exercise: name } : s)));

  // ---------------- guardado ----------------
  const save = async () => {
    if (!repo || !sets || !f || saveState === "saving") return;
    setSaveState("saving"); setSaveError(null); setUndo(null);
    window.clearTimeout(savedTimer.current);
    try {
      const modalityOf = (wid: string) => activeWods.find((w) => w.id === wid)?.spec.modalidad ?? null;
      // Evita duplicados triviales («sentadilla  trasera» = «Sentadilla trasera»); el nombre importado se conserva aparte
      const cat = exerciseCatalog(data.strengthSets.filter((x) => x.activity_id !== a.id));
      const cleanSets = strip(sets).filter((s) => s.exercise.trim())
        .map((s) => ({ ...s, exercise: canonicalName(s.exercise, cat) }))
        .map(normalizeSetForSave);
      // Se envían los resultados tocados y también los que existían (por si se han vaciado)
      const outResults = Object.values(results)
        .filter((r) => isResultTouched(r) || serverResults[resultKey(r)])
        .map((r) => normalizeResultForSave(r, modalityOf(r.workout_id)));
      const feedbackChanged = JSON.stringify(f) !== base.current.f;
      await repo.saveSession(a.id, {
        feedback: feedbackChanged || data.feedback[a.id] ? f : null,
        sets: cleanSets,
        results: data.resultsReady ? outResults : [],
      });
      // Solo se muestra «Guardado» tras confirmarlo el servidor y releer lo guardado
      await refresh();
      const fresh = await loadSets(a.id);
      setSets(fresh);
      base.current = snapshot(fresh, f, results);
      setSaveState("saved");
      savedTimer.current = window.setTimeout(() => setSaveState((st) => (st === "saved" ? "idle" : st)), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaveState("error");
    }
  };
  const discard = () => {
    if (!confirm("¿Descartar los cambios sin guardar?")) return;
    loadSets(a.id).then((s) => {
      const fb = data.feedback[a.id] ?? emptyFeedback(a.id);
      setSets(s); setF(fb); setResults(serverResults);
      base.current = snapshot(s, fb, serverResults);
      setSaveState("idle"); setUndo(null);
    });
  };

  // ---------------- agrupación de series ----------------
  const linkedKeys = new Set<string>();
  for (const w of activeWods) for (const b of w.spec.bloques) for (const it of b.ejercicios) linkedKeys.add(`${w.id}:${it.id}`);
  const setsOf = (w: Workout, it: WodItem) => (sets ?? []).filter((s) => s.workout_id === w.id && s.item_ref === it.id);
  const otherSets = (sets ?? []).filter((s) => !(s.workout_id && s.item_ref && linkedKeys.has(`${s.workout_id}:${s.item_ref}`)));
  const otherGroups = new Map<string, LocalSet[]>();
  for (const s of otherSets) {
    const k = groupKey(s.exercise);
    otherGroups.set(k, [...(otherGroups.get(k) ?? []), s]);
  }

  const color = sportColor(a.category, theme);
  const bike = isBike(a.category);
  const garmin = (a.device_name ?? "").toLowerCase().includes("garmin");
  const setCategory = (c: Sport | null) => run((r) => r.setCategoryOverride(a.id, c), c ? `Clasificada como ${SPORT_LABEL[c]}` : "Categoría automática restablecida");
  const title = activeWods[0]?.title || a.name || SPORT_LABEL[a.category];
  const strengthy = a.category === "hiit" || a.category === "otro";
  const loading = sets === null || f === null;

  const catalog = exerciseCatalog(data.strengthSets);
  const nameFor = (w: Workout, it: WodItem) => setsOf(w, it)[0]?.exercise || it.nombre;
  const associate = (w: Workout, it: WodItem, name: string) => {
    const clean = canonicalName(name, catalog);
    if (!clean) return;
    setSets((cur) => cur && cur.map((s) => (s.workout_id === w.id && s.item_ref === it.id
      ? { ...s, exercise: clean, exercise_original: clean === it.nombre ? null : it.nombre } : s)));
  };
  const resultFor = (w: Workout, blockRef: string) => results[`${w.id}:${blockRef}`] ?? emptyResult(w.id, blockRef);
  const setResult = (r: BlockResult) => setResults((cur) => ({ ...cur, [resultKey(r)]: r }));

  return (
    <div className="touch">
      <div className="row" style={{ marginBottom: 8 }}>
        <Link to="/actividades" className="btn ghost sm"><Icon name="back" />Actividades</Link>
      </div>
      <header className="detail-head">
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          <div className="detail-meta">
            <SportChip cat={a.category} />
            <span>{fmtDayLong(a.local_date)}{a.start_time ? ` · ${fmtTime(a.start_time, tz)}` : ""}</span>
            <span className="num">{fmtDuration(durationOf(a), { short: true })}</span>
            {activeWods[0] && a.name && a.name !== title && <span className="muted">Reloj: {a.name}</span>}
          </div>
        </div>
        <button className="btn" onClick={() => setImporting(true)} disabled={dirty}
          title={dirty ? "Guarda o descarta antes los cambios de esta sesión" : "Pegar el WOD que te devuelve ChatGPT"}>
          <Icon name="upload" />Pegar WOD
        </button>
      </header>

      <div className="tabs-row">
        <Segmented label="Secciones" value={tab} onChange={setTab}
          options={[{ value: "registro", label: "WOD y resultado" }, { value: "reloj", label: "Datos del reloj" }]} />
      </div>

      {tab === "registro" ? (
        <div className="stack">
          {loading ? <p className="small muted">Cargando registro…</p> : (
            <>
              {!data.wodReady && activeWods.length === 0 && strengthy && (
                <p className="status info"><Icon name="info" />Para importar WOD completos falta aplicar la migración de la base de datos. Puedes seguir registrando series.</p>
              )}
              {activeWods.map((w) => (
                <Card key={w.id} title={<div className="stack" style={{ gap: 4 }}><h2>WOD previsto{w.title ? ` · ${w.title}` : ""}</h2><WodSummaryLine wod={w.spec} /></div>}
                  action={<div className="row" style={{ gap: 2 }}>
                    <button className="btn ghost sm" onClick={() => setEditingWod(w)} disabled={dirty} title={dirty ? "Guarda antes los cambios" : undefined}><Icon name="edit" />Editar</button>
                    <button className="btn ghost sm" disabled={dirty} onClick={() => {
                      if (!confirm(`¿Archivar el WOD «${w.title ?? "sin nombre"}»? No se borra: podrás restaurarlo desde «WOD archivados». Tus series se conservan.`)) return;
                      run((r) => r.setWorkoutArchived(w.id, true), "WOD archivado");
                    }}><Icon name="trash" />Archivar</button>
                  </div>}>
                  <div className="stack" style={{ gap: 10 }}>
                    <WodExtras wod={w.spec} position="before" />
                    {w.spec.bloques.map((b, bi) => (
                      <WodBlockCard key={b.id} block={b} index={bi} modality={w.spec.modalidad} itemsHidden={b.tipo !== "descanso"}>
                        {b.tipo !== "descanso" && (
                          <>
                            {b.ejercicios.map((it) => (
                              <ExerciseLog key={it.id} item={it} sets={setsOf(w, it)}
                                title={<>{it.etiqueta && <span className="who" title="Etiqueta del WOD (estación o ejercicio)">{it.etiqueta}</span>}{nameFor(w, it)}</>}
                                header={setsOf(w, it).length > 0 ? <AssocEditor original={it.nombre} current={nameFor(w, it)} catalog={catalog} onChange={(n) => associate(w, it, n)} /> : null}
                                reference={<LastTimeRef exercise={nameFor(w, it)} a={a} />}
                                onAdd={() => addSetFor(w, b.id, it)} onChangeSet={patchSet} onDuplicate={duplicate} onRemove={removeSet} />
                            ))}
                            {data.resultsReady && <BlockResultForm block={b} modality={w.spec.modalidad} result={resultFor(w, b.id)} onChange={setResult} />}
                          </>
                        )}
                      </WodBlockCard>
                    ))}
                    <WodExtras wod={w.spec} position="after" />
                  </div>
                </Card>
              ))}

              {(otherGroups.size > 0 || strengthy) && (
                <Card title={activeWods.length ? "Otros ejercicios" : "Ejercicios, series y cargas"}>
                  <div className="stack" style={{ gap: 12 }}>
                    {[...otherGroups.entries()].map(([k, group]) => (
                      <ExerciseLog key={k || "_"} item={null} sets={group}
                        title={<input className="input ex-name" aria-label="Nombre del ejercicio" value={group[0].exercise} list="cat-all"
                          placeholder="Nombre del ejercicio" onChange={(e) => renameGroup(k, e.target.value)} />}
                        header={group.some((s) => s.exercise_original && s.exercise_original !== s.exercise)
                          ? <span className="tiny muted">Importado como «{group.find((s) => s.exercise_original)?.exercise_original}»</span> : null}
                        reference={<LastTimeRef exercise={group[0].exercise} a={a} />}
                        onAdd={() => addSetFor(null, null, null, group[0].exercise)} onChangeSet={patchSet} onDuplicate={duplicate} onRemove={removeSet} />
                    ))}
                    {otherGroups.size === 0 && !activeWods.length && <p className="small muted">Aún no hay series. Pega el WOD o añade un ejercicio.</p>}
                    <div>
                      <button className="btn sm" onClick={() => setSets((cur) => cur && [...cur, { ...newSetFor(null, { workoutId: null, blockRef: null, setNumber: 1, exercise: "" }), _k: `k${++keySeq}` }])}>
                        <Icon name="plus" />{activeWods.length ? "Añadir ejercicio no previsto" : "Añadir ejercicio"}
                      </button>
                    </div>
                  </div>
                </Card>
              )}

              <datalist id="cat-all">{catalog.map((c) => <option key={c.key} value={c.name} />)}</datalist>
              {f && <FeedbackForm a={a} f={f} setF={setF} hasExisting={Boolean(data.feedback[a.id])} />}
              <WodLinkTools a={a} />
            </>
          )}
          <SaveBar state={saveState} error={saveError} onSave={save} onDiscard={discard} undo={undo} />
        </div>
      ) : (
        <WatchData a={a} streams={streams} splits={splits} color={color} bike={bike} units={units} tz={tz} mode={mode}
          garmin={garmin} setCategory={setCategory} onDelete={async () => {
            if (!confirm("¿Eliminar esta actividad importada? Se borrarán también sus series.")) return;
            await run((r) => r.deleteImportedActivity(a.id), "Actividad eliminada");
            nav("/actividades");
          }} />
      )}

      {tab === "reloj" && dirty && (
        <SaveBar state={saveState} error={saveError} onSave={save} onDiscard={discard} undo={undo} />
      )}
      {importing && <WodImportModal fixedActivityId={a.id} onClose={() => setImporting(false)}
        onSaved={() => loadSets(a.id).then((s) => { setSets(s); base.current = snapshot(s, f, results); })} />}
      {editingWod && <WodEditModal w={editingWod} onClose={() => setEditingWod(null)} />}
      {blocker.state === "blocked" && (
        <Modal title="Tienes cambios sin guardar" onClose={() => blocker.reset?.()} footer={<>
          <button className="btn" onClick={() => blocker.reset?.()}>Seguir editando</button>
          <button className="btn danger" onClick={() => blocker.proceed?.()}>Salir sin guardar</button>
        </>}>
          <p className="small">Si sales ahora se perderán los cambios de esta sesión que aún no has guardado.</p>
        </Modal>
      )}
    </div>
  );
}

function WatchData({ a, streams, splits, color, bike, units, tz, mode, garmin, setCategory, onDelete }: {
  a: Activity; streams: Streams | null | undefined; splits: { km: number; secs: number }[]; color: string; bike: boolean;
  units: ReturnType<typeof useApp>["units"]; tz: string; mode: ReturnType<typeof useApp>["mode"]; garmin: boolean;
  setCategory: (c: Sport | null) => void; onDelete: () => void;
}) {
  return (
    <div className="split">
      <div className="stack">
        <div className="row" style={{ gap: 6 }}>
          <OriginBadge origin={a.data_origin === "manual" ? "manual" : "medido"} />
          {a.source === "import" && <span className="badge">Importada desde archivo</span>}
          {intensityBucket(a) && <span className="badge">Intensidad {intensityLabel(intensityBucket(a)).toLowerCase()}</span>}
          <span className="small muted">{a.device_name ?? "Dispositivo desconocido"} · {mode === "demo" ? "Datos de demostración" : a.source === "intervals" ? `Intervals.icu${a.last_synced_at ? ` (sincronizado ${fmtDateTime(a.last_synced_at, tz)})` : ""}` : "Archivo importado"}</span>
        </div>
        {(a.category_needs_review || a.api_restricted) && (
          <Card pad>
            {a.category_needs_review && <p className="status warn"><Icon name="alert" />El tipo de origen («{sourceTypeLabel(a.source_type)}») es ambiguo. Indica la categoría correcta.</p>}
            {a.api_restricted && <p className="status warn"><Icon name="alert" />Intervals.icu no ha devuelto todos los datos de esta actividad (posible restricción de datos de Garmin por API). Puedes importar el archivo FIT original.</p>}
          </Card>
        )}
        <div className="grid stats">
          <Stat label="Duración" value={fmtDuration(a.duration_s, { short: true })} foot={bike || a.category === "run" ? `En movimiento: ${fmtDuration(a.moving_time_s, { short: true })}` : undefined} />
          <Stat label="FC media" value={isNum(a.avg_hr) ? Math.round(a.avg_hr) : null} unit="ppm" foot={`Máxima: ${fmtHr(a.max_hr)}`} />
          <Stat label="Carga" value={isNum(a.training_load) ? fmtNum(a.training_load) : null} foot="Calculada por Intervals.icu" />
          <Stat label="Calorías" value={isNum(a.calories) ? fmtNum(a.calories) : null} unit="kcal" badge={<OriginBadge origin="estimado" />} />
          {(bike || a.category === "run") && <>
            <Stat label="Distancia" value={isNum(a.distance_m) ? fmtDistance(a.distance_m, units) : null} />
            <Stat label="Desnivel positivo" value={isNum(a.elevation_gain_m) ? fmtElevation(a.elevation_gain_m, units) : null} />
            {a.category === "run"
              ? <Stat label="Ritmo medio" value={isNum(a.avg_speed_ms) ? fmtPace(a.avg_speed_ms, units) : null} />
              : <Stat label="Velocidad media" value={isNum(a.avg_speed_ms) ? fmtSpeed(a.avg_speed_ms, units) : null}
                foot={a.category === "emtb" ? "Depende de la asistencia: no mide forma física" : undefined} />}
            <Stat label="Cadencia media" value={isNum(a.avg_cadence) ? fmtNum(a.avg_cadence) : null} unit={a.category === "run" ? "ppm" : "rpm"} />
          </>}
          {bike && (
            <Stat label="Potencia del ciclista" value={a.rider_power_source === "medidor" && isNum(a.rider_avg_power_w) ? fmtNum(a.rider_avg_power_w) : null} unit="W"
              foot={a.rider_power_source === "medidor" ? "Medidor de potencia" : a.rider_power_source === "estimado" ? "Solo hay una estimación del origen: no se muestra" : "Sin medidor de potencia"} />
          )}
        </div>
        <Card title="Frecuencia cardiaca">
          {streams === undefined ? <p className="small muted">Cargando serie temporal…</p>
            : streams?.time && streams.heartrate ? <HrChart time={streams.time} hr={streams.heartrate} bounds={a.hr_zone_bounds} />
              : <p className="small muted">Sin serie temporal de frecuencia cardiaca.</p>}
        </Card>
        <Card title="Tiempo en zonas"><ZoneBars times={a.hr_zone_times_s} bounds={a.hr_zone_bounds} /></Card>
        {(bike || a.category === "run") && (
          <Card title="Recorrido y elevación">
            {streams?.latlng && streams.latlng.length > 1 ? (
              <Suspense fallback={<p className="small muted">Cargando mapa…</p>}><MapView points={streams.latlng} color={color} /></Suspense>
            ) : <p className="small muted">Sin datos GPS para esta actividad.</p>}
            {streams?.altitude && streams.distance ? (
              <div style={{ marginTop: 12 }}><ElevationChart distance={streams.distance} altitude={streams.altitude} color={color} /></div>
            ) : <p className="small muted" style={{ marginTop: 8 }}>Sin perfil de elevación.</p>}
          </Card>
        )}
        {a.category === "run" && splits.length > 0 && (
          <Card title="Parciales por kilómetro">
            <table className="data"><thead><tr><th>Km</th><th className="n">Tiempo del kilómetro (ritmo)</th></tr></thead>
              <tbody>{splits.map((s) => <tr key={s.km}><td>{s.km}</td><td className="n">{fmtClock(s.secs)} /km</td></tr>)}</tbody>
            </table>
          </Card>
        )}
        <Compare a={a} />
      </div>
      <div className="stack">
        <Card title="Clasificación">
          <div className="stack" style={{ gap: 10 }}>
            <p className="small ink2">Tipo original: <b>{sourceTypeLabel(a.source_type)}</b>{a.source_type ? <span className="muted"> ({a.source_type})</span> : null}</p>
            <p className="small ink2">Categoría automática: <b>{SPORT_LABEL[a.category_auto]}</b>{a.category_override && <> · Corregida a <b>{SPORT_LABEL[a.category_override]}</b></>}</p>
            <Field label="Categoría" hint="Tu corrección se conserva aunque la actividad se vuelva a sincronizar.">
              <select className="input" value={a.category_override ?? ""} onChange={(e) => setCategory((e.target.value || null) as Sport | null)}>
                <option value="">Automática ({SPORT_LABEL[a.category_auto]})</option>
                {SPORTS.map((s) => <option key={s} value={s}>{SPORT_LABEL[s]} — {SPORT_DESCRIPTION[s]}</option>)}
              </select>
            </Field>
          </div>
        </Card>
        {garmin && <p className="tiny muted">Datos registrados con un dispositivo Garmin.</p>}
        {a.source === "import" && <button className="btn danger" onClick={onDelete}><Icon name="trash" />Eliminar actividad importada</button>}
      </div>
    </div>
  );
}
