import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../data/AppData";
import { addDays, fmtDayLong } from "../lib/dates";
import { SPORT_LABEL } from "../lib/sports";
import type { Feedback, StrengthSet } from "../lib/types";
import { newClientRef, parseWodInput, type LegacyRow, type WodParseResult, type WodSpec } from "../lib/wod";
import { Icon } from "./icons";
import { Modal } from "./ui";
import { PendingFlag, WodEditor, WodView } from "./Wod";

type LinkKind = "" | "actividad" | "planificada" | "ninguno";
type Conflict = "" | "anadir" | "sustituir";

const PROMPT_HINT = "Pega el bloque que te devuelve ChatGPT (JSON «adolfo-wod», con o sin ```), o la tabla antigua «Ejercicio | Serie | Reps | Peso(kg)».";

/**
 * Importación de un WOD en una sola operación:
 * pegar → previsualizar y corregir → elegir vínculo → confirmar.
 * Nada se guarda hasta pulsar «Guardar»; cancelar no cambia nada.
 */
export function WodImportModal({ onClose, fixedActivityId, onSaved }: {
  onClose: () => void;
  /** Si se abre desde una actividad, el vínculo es esa actividad (elegida explícitamente al abrir desde ella). */
  fixedActivityId?: string;
  onSaved?: (activityId: string | null) => void;
}) {
  const { data, repo, refresh, notify, today, mode } = useApp();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<WodParseResult | null>(null);
  const [wod, setWod] = useState<WodSpec | null>(null);
  const [rows, setRows] = useState<LegacyRow[]>([]);
  const [addUnrecToNotes, setAddUnrecToNotes] = useState(true);
  const [linkKind, setLinkKind] = useState<LinkKind>(fixedActivityId ? "actividad" : "");
  const [activityId, setActivityId] = useState(fixedActivityId ?? "");
  const [plannedId, setPlannedId] = useState("");
  const [conflict, setConflict] = useState<Conflict>("");
  const [existingSets, setExistingSets] = useState<StrengthSet[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const clientRef = useRef(newClientRef());
  // Resultado calculado una sola vez por confirmación: un reintento guarda exactamente lo mismo
  const legacySnapshot = useRef<StrengthSet[] | null>(null);

  const step = parsed && parsed.kind !== "error" ? "revisar" : "pegar";
  const isLegacy = parsed?.kind === "legacy";

  const review = () => {
    const r = parseWodInput(text);
    setParsed(r);
    setSaveError(null);
    clientRef.current = newClientRef();
    legacySnapshot.current = null;
    if (r.kind === "wod") setWod(r.wod);
    if (r.kind === "legacy") {
      setRows(r.rows);
      if (linkKind === "planificada" || linkKind === "ninguno") setLinkKind("");
    }
  };

  const backToText = () => { setParsed(null); setSaveError(null); };

  const activities = useMemo(() => [...data.activities]
    .filter((a) => a.local_date >= addDays(today, -120))
    .sort((a, b) => b.local_date.localeCompare(a.local_date) || (b.start_time ?? "").localeCompare(a.start_time ?? "")),
  [data.activities, today]);
  const planned = useMemo(() => data.planned
    .filter((p) => p.date >= addDays(today, -30) && p.status !== "omitida" && p.category !== "descanso")
    .sort((a, b) => a.date.localeCompare(b.date)), [data.planned, today]);

  const wodDate = wod?.fecha ?? null;
  const activeWorkouts = data.workouts.filter((w) => !w.superseded_at);
  const existingWods = linkKind === "actividad" && activityId ? activeWorkouts.filter((w) => w.activity_id === activityId)
    : linkKind === "planificada" && plannedId ? activeWorkouts.filter((w) => w.planned_session_id === plannedId) : [];

  // Series ya guardadas en la actividad (para el formato antiguo: añadir o sustituir)
  useEffect(() => {
    setExistingSets(null);
    if (!isLegacy || !activityId || !repo) return;
    let alive = true;
    repo.getStrengthSets(activityId).then((s) => alive && setExistingSets(s)).catch(() => alive && setExistingSets([]));
    return () => { alive = false; };
  }, [isLegacy, activityId, repo]);

  useEffect(() => { setConflict(""); legacySnapshot.current = null; }, [linkKind, activityId, plannedId]);

  const needsConflict = isLegacy ? (existingSets?.length ?? 0) > 0 : existingWods.length > 0;
  const linkReady = isLegacy
    ? Boolean(activityId) && existingSets !== null
    : linkKind === "ninguno" || (linkKind === "actividad" && Boolean(activityId)) || (linkKind === "planificada" && Boolean(plannedId));
  const contentReady = isLegacy ? rows.some((r) => r.exercise.trim()) : Boolean(wod && (wod.bloques.length || wod.calentamiento));
  const canSave = step === "revisar" && contentReady && linkReady && (!needsConflict || conflict !== "") && !saving && (isLegacy || data.wodReady);

  const save = async () => {
    if (!repo || !canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (isLegacy) {
        if (!legacySnapshot.current) {
          const incoming: StrengthSet[] = rows.filter((r) => r.exercise.trim()).map((r) => ({
            exercise: r.exercise.trim(), set_number: r.set_number, reps: r.reps, weight_kg: r.weight_kg,
            duration_s: null, notes: null, status: r.pending ? "pendiente" : "realizado",
          }));
          legacySnapshot.current = conflict === "sustituir" ? incoming : [...(existingSets ?? []), ...incoming];
        }
        await repo.saveStrengthSets(activityId, legacySnapshot.current);
        const unrec = parsed?.kind === "legacy" ? parsed.unrecognized : [];
        if (addUnrecToNotes && unrec.length) {
          const fb: Feedback = data.feedback[activityId] ?? {
            activity_id: activityId, rpe: null, sensations: null, notes: null, terrain_notes: null,
            ebike_battery_start_pct: null, ebike_battery_end_pct: null, ebike_assist_notes: null,
          };
          const block = unrec.join("\n");
          if (!(fb.notes ?? "").includes(block)) await repo.saveFeedback({ ...fb, notes: fb.notes ? `${fb.notes}\n\n${block}` : block });
        }
        await refresh();
        notify(`${legacySnapshot.current.length} serie(s) guardadas en la actividad`);
        onSaved?.(activityId);
      } else if (wod) {
        const supersede = conflict === "sustituir" ? existingWods.map((w) => w.id) : [];
        const link = {
          activity_id: linkKind === "actividad" ? activityId : null,
          planned_session_id: linkKind === "planificada" ? plannedId : null,
        };
        await repo.saveWorkout({
          client_ref: clientRef.current, ...link, title: wod.nombre, wod_date: wod.fecha, modality: wod.modalidad,
          spec: wod, source_text: text,
        }, supersede);
        await refresh();
        notify(conflict === "sustituir" ? "WOD sustituido (el anterior queda archivado)" : "WOD guardado");
        onSaved?.(link.activity_id);
      }
      onClose();
    } catch (e) {
      // El formulario se conserva tal cual para reintentar
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (text.trim() && !confirm("¿Cerrar sin guardar? Se descartará el texto pegado.")) return;
    onClose();
  };

  const footer = step === "pegar" ? (
    <>
      <button className="btn" onClick={requestClose}>Cancelar</button>
      <button className="btn primary" onClick={review} disabled={!text.trim()}>Revisar</button>
    </>
  ) : (
    <>
      <button className="btn ghost" onClick={backToText} disabled={saving}><Icon name="back" />Volver al texto</button>
      <button className="btn" onClick={requestClose} disabled={saving}>Cancelar</button>
      <button className="btn primary" onClick={save} disabled={!canSave} aria-busy={saving}>
        {saving ? "Guardando…" : isLegacy ? "Guardar series" : "Guardar WOD"}
      </button>
    </>
  );

  return (
    <Modal title="Pegar WOD" onClose={requestClose} footer={footer} wide>
      {step === "pegar" ? (
        <div className="stack" style={{ gap: 10 }}>
          <label htmlFor="wod-text" className="small ink2">{PROMPT_HINT}</label>
          <textarea id="wod-text" className="input mono" rows={14} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'```json\n{\n  "formato": "adolfo-wod",\n  "version": 1,\n  ...\n}\n```'} spellCheck={false} />
          {parsed?.kind === "error" && (
            <div className="form-error" role="alert">
              {parsed.errors.map((e) => <p key={e}>{e}</p>)}
              <p className="muted">Tu texto se mantiene: corrígelo o vuelve a copiarlo y pulsa «Revisar».</p>
            </div>
          )}
          {!data.wodReady && (
            <p className="status warn"><Icon name="alert" />La base de datos aún no tiene la migración de WOD: solo se puede importar el formato antiguo de series.</p>
          )}
          {mode === "demo" && <p className="tiny muted">Modo demostración: lo que importes vive solo en esta pestaña.</p>}
        </div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {parsed && parsed.kind !== "error" && parsed.warnings.length > 0 && (
            <div className="wod-ambig">
              <PendingFlag>Avisos de la lectura</PendingFlag>
              <ul>{parsed.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}

          {isLegacy ? (
            <LegacyPreview rows={rows} setRows={setRows} unrecognized={parsed?.kind === "legacy" ? parsed.unrecognized : []}
              addUnrec={addUnrecToNotes} setAddUnrec={setAddUnrecToNotes} />
          ) : wod && (
            <div className="wod-preview">
              <div className="wod-preview-edit">
                <h3 className="small ink2" style={{ marginBottom: 8 }}>Corrige lo necesario</h3>
                <WodEditor value={wod} onChange={setWod} />
              </div>
              <div className="wod-preview-view">
                <h3 className="small ink2" style={{ marginBottom: 8 }}>Así quedará</h3>
                <WodView wod={wod} />
              </div>
            </div>
          )}

          <fieldset className="link-box">
            <legend>{isLegacy ? "¿En qué actividad guardo las series?" : "¿Con qué lo vinculo?"}</legend>
            {fixedActivityId ? (
              <p className="small">Actividad actual: <b>{labelActivity(data.activities.find((a) => a.id === fixedActivityId))}</b></p>
            ) : (
              <>
                {!isLegacy && (
                  <div className="row" role="radiogroup" aria-label="Tipo de vínculo">
                    {(["actividad", "planificada", "ninguno"] as const).map((k) => (
                      <label key={k} className="radio">
                        <input type="radio" name="link" checked={linkKind === k} onChange={() => setLinkKind(k)} />
                        {k === "actividad" ? "Actividad realizada" : k === "planificada" ? "Sesión planificada" : "Sin vincular por ahora"}
                      </label>
                    ))}
                  </div>
                )}
                {(isLegacy || linkKind === "actividad") && (
                  <select className="input" aria-label="Actividad" value={activityId} onChange={(e) => { setActivityId(e.target.value); if (isLegacy) setLinkKind("actividad"); }}>
                    <option value="">Elige la actividad…</option>
                    {activities.map((a) => (
                      <option key={a.id} value={a.id}>{labelActivity(a)}{wodDate && a.local_date === wodDate ? " · misma fecha que el WOD" : ""}</option>
                    ))}
                  </select>
                )}
                {!isLegacy && linkKind === "planificada" && (
                  planned.length ? (
                    <select className="input" aria-label="Sesión planificada" value={plannedId} onChange={(e) => setPlannedId(e.target.value)}>
                      <option value="">Elige la sesión…</option>
                      {planned.map((p) => <option key={p.id} value={p.id}>{fmtDayLong(p.date)} · {p.title} ({SPORT_LABEL[p.category as keyof typeof SPORT_LABEL] ?? p.category})</option>)}
                    </select>
                  ) : <p className="small muted">No hay sesiones planificadas recientes o próximas.</p>
                )}
                {!isLegacy && linkKind === "ninguno" && (
                  <p className="small muted">Se guarda el WOD previsto sin crear ninguna actividad. Podrás vincularlo desde el detalle de la actividad cuando la tengas.</p>
                )}
              </>
            )}

            {needsConflict && (
              <div className="conflict" role="group" aria-label="Ya existe un registro">
                <p className="small"><Icon name="alert" className="ico" style={{ color: "var(--warn)" }} />{" "}
                  {isLegacy ? `Esta actividad ya tiene ${existingSets?.length} serie(s) guardadas.` : `Ya hay ${existingWods.length === 1 ? "un WOD" : `${existingWods.length} WOD`} vinculado aquí («${existingWods[0]?.title ?? "sin nombre"}»).`}
                  {" "}¿Qué hago?</p>
                <label className="radio"><input type="radio" name="conflict" checked={conflict === "anadir"} onChange={() => setConflict("anadir")} />
                  {isLegacy ? "Añadir estas series a las existentes" : "Añadir este WOD además del existente"}</label>
                <label className="radio"><input type="radio" name="conflict" checked={conflict === "sustituir"} onChange={() => setConflict("sustituir")} />
                  {isLegacy ? `Sustituir las ${existingSets?.length} series existentes` : "Sustituir el existente (queda archivado, no se borra)"}</label>
              </div>
            )}
          </fieldset>

          {saveError && (
            <div className="form-error" role="alert">
              <p>No se ha podido guardar: {saveError}</p>
              <p className="muted">No se ha perdido nada de lo que ves. Puedes reintentar; no se crearán duplicados.</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function labelActivity(a: { local_date: string; name: string | null; category: keyof typeof SPORT_LABEL } | undefined): string {
  if (!a) return "Actividad no encontrada";
  return `${fmtDayLong(a.local_date)} · ${a.name || SPORT_LABEL[a.category]} (${SPORT_LABEL[a.category]})`;
}

function LegacyPreview({ rows, setRows, unrecognized, addUnrec, setAddUnrec }: {
  rows: LegacyRow[]; setRows: (r: LegacyRow[]) => void; unrecognized: string[]; addUnrec: boolean; setAddUnrec: (v: boolean) => void;
}) {
  const upd = (i: number, patch: Partial<LegacyRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const num = (v: string) => { const t = v.trim().replace(",", "."); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : null; };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="small ink2">Formato antiguo detectado: se guardarán como series realizadas. Las marcadas como pendientes quedarán señaladas hasta que completes el dato.</p>
      <div className="set-rows">
        {rows.map((r, i) => (
          <div key={i} className="set-row legacy">
            <input className="input" aria-label="Ejercicio" value={r.exercise} onChange={(e) => upd(i, { exercise: e.target.value })} />
            <label className="mini"><span>Serie</span><input className="input" inputMode="numeric" value={r.set_number} onChange={(e) => upd(i, { set_number: Math.max(1, Math.round(num(e.target.value) ?? 1)) })} /></label>
            <label className="mini"><span>Reps</span><input className="input" inputMode="numeric" value={r.reps ?? ""} onChange={(e) => upd(i, { reps: num(e.target.value) })} /></label>
            <label className="mini"><span>Kg</span><input className="input" inputMode="decimal" value={r.weight_kg ?? ""} onChange={(e) => upd(i, { weight_kg: num(e.target.value) })} /></label>
            <label className="radio small"><input type="checkbox" checked={r.pending} onChange={(e) => upd(i, { pending: e.target.checked })} />Pendiente</label>
            <button type="button" className="btn ghost sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Quitar ${r.exercise}`}><Icon name="trash" /></button>
          </div>
        ))}
      </div>
      {unrecognized.length > 0 && (
        <div className="wod-ambig">
          <PendingFlag>Líneas no reconocidas ({unrecognized.length})</PendingFlag>
          <ul>{unrecognized.map((u, i) => <li key={i} className="mono small">{u}</li>)}</ul>
          <label className="radio small"><input type="checkbox" checked={addUnrec} onChange={(e) => setAddUnrec(e.target.checked)} />Añadirlas a las notas de la sesión para no perderlas</label>
        </div>
      )}
    </div>
  );
}
