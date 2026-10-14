import { useId, useState, type ReactNode } from "react";
import { exerciseVolume, fmtKg, LOAD_MODE_LABEL, normalizeSetForSave, totalLoadKg } from "../lib/loads";
import { METRIC_LABEL, resultFieldsFor, targetHint, workUnitFor, loadRelevant, type MetricKey } from "../lib/session";
import type { BlockResult, LoadMode, ResultMetrics, StrengthSet } from "../lib/types";
import { describeLoad, describeTarget, type WodBlock, type WodItem, type WodSpec } from "../lib/wod";
import { Icon } from "./icons";
import { PendingFlag } from "./Wod";

/** Serie en edición con una clave local estable (no se guarda). */
export type LocalSet = StrengthSet & { _k: string };

// ---------------------------------------------------------------------
// Campos numéricos: teclado numérico, coma o punto, vacío = desconocido
// ---------------------------------------------------------------------
export function parseNum(v: string, opts: { int?: boolean } = {}): number | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return opts.int ? Math.round(n) : n;
}

export function NumField({ label, unit, value, onChange, int = false, placeholder, width = 70, hint, hideLabel = false }: {
  label: string; unit?: string; value: number | null | undefined; onChange: (v: number | null) => void;
  int?: boolean; placeholder?: string; width?: number; hint?: string; hideLabel?: boolean;
}) {
  const id = useId();
  // Texto local para permitir escribir «22,» sin perder la coma
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null || value === undefined ? "" : String(value).replace(".", ","));
  return (
    <div className="nf">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>{label}</label>
      <div className="nf-box">
        <input id={id} className="input" style={{ width }} inputMode={int ? "numeric" : "decimal"} autoComplete="off"
          value={shown} placeholder={placeholder}
          onChange={(e) => { setDraft(e.target.value); onChange(parseNum(e.target.value, { int })); }}
          onBlur={() => setDraft(null)} />
        {unit && <span className="nf-unit">{unit}</span>}
      </div>
      {hint && <span className="nf-hint">{hint}</span>}
    </div>
  );
}

export function TimeField({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  const m = value != null ? Math.floor(value / 60) : null;
  const s = value != null ? Math.round(value % 60) : null;
  const set = (mm: number | null, ss: number | null) => onChange(mm === null && ss === null ? null : (mm ?? 0) * 60 + Math.min(59, ss ?? 0));
  return (
    <div className="nf" role="group" aria-label={label}>
      <span className="nf-label">{label}</span>
      <div className="nf-box">
        <input className="input" style={{ width: 54 }} inputMode="numeric" aria-label={`${label}: minutos`} value={m ?? ""}
          onChange={(e) => set(parseNum(e.target.value, { int: true }), s)} />
        <span className="nf-unit">min</span>
        <input className="input" style={{ width: 54 }} inputMode="numeric" aria-label={`${label}: segundos`} value={s ?? ""}
          onChange={(e) => set(m, parseNum(e.target.value, { int: true }))} />
        <span className="nf-unit">s</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Carga: total / por implemento / sin carga / sin aclarar (histórico)
// ---------------------------------------------------------------------
function LoadField({ s, onChange }: { s: StrengthSet; onChange: (patch: Partial<StrengthSet>) => void }) {
  const id = useId();
  const mode = s.load_mode ?? null;
  const total = totalLoadKg(s);
  const setMode = (m: LoadMode | "") => {
    if (m === "") return;
    if (m === "por_implemento") {
      // Si venía un total, no se adivina el reparto: se pide el peso de cada implemento
      onChange({ load_mode: m, implements: s.implements ?? null, load_per_implement_kg: null });
    } else if (m === "total") {
      // Al pasar de «sin aclarar» a «total» se conserva el valor original
      onChange({ load_mode: m, weight_kg: mode === "por_implemento" ? total : s.weight_kg, implements: null, load_per_implement_kg: null });
    } else onChange({ load_mode: m });
  };
  return (
    <div className="nf load">
      <label htmlFor={id}>Carga</label>
      <div className="nf-box">
        {mode === "por_implemento" ? (
          <>
            <input className="input" style={{ width: 46 }} inputMode="numeric" aria-label="Número de implementos" placeholder="nº"
              value={s.implements ?? ""} onChange={(e) => onChange({ implements: parseNum(e.target.value, { int: true }) || null })} />
            <span className="nf-unit">×</span>
            <input className="input" style={{ width: 64 }} inputMode="decimal" aria-label="Kilos de cada implemento"
              value={s.load_per_implement_kg ?? ""} onChange={(e) => onChange({ load_per_implement_kg: parseNum(e.target.value) || null })} />
          </>
        ) : mode === "sin_carga" ? null : (
          <input className="input" style={{ width: 70 }} inputMode="decimal" aria-label={mode === null ? "Kilos (sin aclarar)" : "Kilos totales"}
            value={s.weight_kg ?? ""} onChange={(e) => onChange({ weight_kg: parseNum(e.target.value) })} />
        )}
        <select id={id} className="input load-mode" value={mode ?? ""} onChange={(e) => setMode(e.target.value as LoadMode | "")}
          aria-label="Cómo se interpreta la carga">
          {mode === null && <option value="">kg · sin aclarar</option>}
          {(Object.keys(LOAD_MODE_LABEL) as LoadMode[]).map((m) => <option key={m} value={m}>{LOAD_MODE_LABEL[m]}</option>)}
        </select>
      </div>
      {mode === "por_implemento" && (
        <span className="nf-hint calc">{total !== null ? `= ${fmtKg(total)} kg en total` : s.implements ? "Falta el peso de cada implemento" : "Indica cuántos implementos"}</span>
      )}
      {mode === null && s.weight_kg != null && <span className="nf-hint warn">Registro antiguo: ¿total o por implemento?</span>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Fila de serie
// ---------------------------------------------------------------------
export function SetRow({ s, index, item, onChange, onDuplicate, onRemove }: {
  s: LocalSet; index: number; item: WodItem | null;
  onChange: (patch: Partial<StrengthSet>) => void; onDuplicate: () => void; onRemove: () => void;
}) {
  const unit = workUnitFor(item);
  const hint = targetHint(item, index);
  const [more, setMore] = useState(Boolean(s.reps_scope === "por_lado" || s.notes || (unit === "reps" && (s.duration_s || s.distance_m || s.calories))));
  const pendingNow = normalizeSetForSave(s).status === "pendiente";
  const showLoad = loadRelevant(item) || (s.load_mode !== "sin_carga" && s.load_mode != null) || s.weight_kg != null;
  return (
    <div className={`set-row ${pendingNow ? "pending" : ""}`}>
      <span className="set-n" aria-label={`Serie ${s.set_number}`}>{s.set_number}</span>
      {unit === "reps" && <NumField label={s.reps_scope === "por_lado" ? "Reps/lado" : "Reps"} int value={s.reps} onChange={(v) => onChange({ reps: v })}
        placeholder={hint ?? undefined} width={60} />}
      {unit === "segundos" && <NumField label="Tiempo" unit="s" int value={s.duration_s} onChange={(v) => onChange({ duration_s: v })} placeholder={hint ?? undefined} width={60} />}
      {unit === "metros" && <NumField label="Distancia" unit="m" value={s.distance_m} onChange={(v) => onChange({ distance_m: v })} placeholder={hint ?? undefined} width={64} />}
      {unit === "calorias" && <NumField label="Calorías" unit="cal" value={s.calories} onChange={(v) => onChange({ calories: v })} placeholder={hint ?? undefined} width={60} />}
      {showLoad && <LoadField s={s} onChange={onChange} />}
      <div className="set-actions">
        <button type="button" className="btn ghost sm" onClick={() => setMore((x) => !x)} aria-expanded={more} aria-label="Más opciones de la serie">
          <Icon name="more" />
        </button>
        <button type="button" className="btn ghost sm" onClick={onDuplicate} aria-label={`Duplicar serie ${s.set_number}`} title="Duplicar serie">
          <Icon name="plus" />Duplicar
        </button>
        <button type="button" className="btn ghost sm" onClick={onRemove} aria-label={`Quitar serie ${s.set_number}`}><Icon name="trash" /></button>
      </div>
      {pendingNow && <div className="set-flag"><PendingFlag>Falta un dato{s.status === "pendiente" && s.weight_kg == null ? " (peso por revisar)" : ""}</PendingFlag></div>}
      {more && (
        <div className="set-more">
          {unit === "reps" && (
            <label className="radio small"><input type="checkbox" checked={s.reps_scope === "por_lado"}
              onChange={(e) => onChange({ reps_scope: e.target.checked ? "por_lado" : "total" })} />Repeticiones por lado</label>
          )}
          {unit !== "segundos" && <NumField label="Tiempo" unit="s" int value={s.duration_s} onChange={(v) => onChange({ duration_s: v })} width={60} />}
          {unit !== "metros" && <NumField label="Distancia" unit="m" value={s.distance_m} onChange={(v) => onChange({ distance_m: v })} width={64} />}
          {unit !== "calorias" && <NumField label="Calorías" unit="cal" value={s.calories} onChange={(v) => onChange({ calories: v })} width={60} />}
          <div className="nf grow">
            <label htmlFor={`${s._k}-n`}>Nota</label>
            <input id={`${s._k}-n`} className="input" value={s.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value || null })} placeholder="Adaptación, sensaciones…" />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Ejercicio: previsto + lo que hice
// ---------------------------------------------------------------------
export function ExerciseLog({ title, item, sets, onAdd, onChangeSet, onDuplicate, onRemove, header, reference }: {
  title: ReactNode; item: WodItem | null; sets: LocalSet[];
  onAdd: () => void; onChangeSet: (k: string, patch: Partial<StrengthSet>) => void;
  onDuplicate: (k: string) => void; onRemove: (k: string) => void; header?: ReactNode; reference?: ReactNode;
}) {
  const target = item ? describeTarget(item.objetivo) : null;
  const plannedLoad = item ? describeLoad(item.carga) : null;
  const vol = exerciseVolume(sets.map(normalizeSetForSave));
  return (
    <div className="ex-log">
      <div className="ex-head">
        <div className="ex-title">{title}</div>
        {(target || plannedLoad) && (
          <div className="ex-planned"><span className="tag-planned">Previsto</span>{[target, plannedLoad].filter(Boolean).join(" · ")}</div>
        )}
        {header}
        {reference}
      </div>
      {sets.length > 0 ? (
        <div className="set-rows" aria-label="Lo que hice">
          {sets.map((s, i) => (
            <SetRow key={s._k} s={s} index={i} item={item} onChange={(p) => onChangeSet(s._k, p)}
              onDuplicate={() => onDuplicate(s._k)} onRemove={() => onRemove(s._k)} />
          ))}
        </div>
      ) : <p className="small muted">Sin series registradas.</p>}
      <div className="row between" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm" onClick={onAdd}><Icon name="plus" />Añadir serie</button>
        {vol.applicable && (
          <span className="small calc-value" title="Repeticiones totales × carga externa total. Solo de este ejercicio.">
            Volumen{vol.partial ? " parcial" : ""}: {vol.kg !== null ? `${fmtKg(vol.kg)} kg` : "sin datos suficientes"}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Resultado del bloque
// ---------------------------------------------------------------------
function MetricsFields({ fields, value, onChange, prefix }: {
  fields: MetricKey[]; value: ResultMetrics; onChange: (m: ResultMetrics) => void; prefix: string;
}) {
  return (
    <div className="metrics-row">
      {fields.map((k) => k === "time_s"
        ? <TimeField key={k} label={METRIC_LABEL.time_s.label} value={value.time_s} onChange={(v) => onChange({ ...value, time_s: v })} />
        : <NumField key={k} label={METRIC_LABEL[k].label} unit={METRIC_LABEL[k].unit} int={k === "rounds" || k === "reps"}
            value={value[k]} onChange={(v) => onChange({ ...value, [k]: v })} width={64} hint={prefix} />)}
    </div>
  );
}

export function BlockResultForm({ block, modality, result, onChange }: {
  block: WodBlock; modality: WodSpec["modalidad"]; result: BlockResult; onChange: (r: BlockResult) => void;
}) {
  const fields = resultFieldsFor(block);
  const pairs = modality === "parejas";
  const [open, setOpen] = useState(Boolean(result.adaptations || result.notes || result.rpe));
  const st = result.status;
  return (
    <div className="block-result">
      <div className="row between">
        <span className="tag-done">Mi resultado</span>
        <div className="segmented" role="group" aria-label="Estado del bloque">
          <button type="button" aria-pressed={st === null} onClick={() => onChange({ ...result, status: null })}>Pendiente</button>
          <button type="button" aria-pressed={st === "realizado"} onClick={() => onChange({ ...result, status: "realizado" })}>Hecho</button>
          <button type="button" aria-pressed={st === "no_realizado"} onClick={() => onChange({ ...result, status: "no_realizado" })}>No hecho</button>
        </div>
      </div>
      {st === null && <PendingFlag>Resultado pendiente de registrar</PendingFlag>}
      {st === "realizado" && fields.length > 0 && (pairs ? (
        <div className="pair-grid">
          <div>
            <p className="small ink2"><b>Equipo</b></p>
            <MetricsFields fields={fields} value={result.team} onChange={(m) => onChange({ ...result, team: m })} prefix="" />
          </div>
          <div>
            <p className="small ink2"><b>Mi contribución</b> <span className="muted">· vacío = desconocida</span></p>
            <MetricsFields fields={fields} value={result.personal} onChange={(m) => onChange({ ...result, personal: m })} prefix="" />
          </div>
          <p className="tiny muted" style={{ gridColumn: "1 / -1" }}>Tu contribución no se calcula a partir del resultado del equipo ni se divide entre dos.</p>
        </div>
      ) : (
        <MetricsFields fields={fields} value={result.personal} onChange={(m) => onChange({ ...result, personal: m })} prefix="" />
      ))}
      {st !== null && (
        <details className="disclosure" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary><Icon name="chevron" className="ico chev" />Adaptaciones, RPE y notas del bloque</summary>
          <div className="stack" style={{ gap: 8, paddingBottom: 10 }}>
            <div className="nf">
              <span className="nf-label">RPE real del bloque</span>
              <div className="scale" style={{ gridTemplateColumns: "repeat(10, minmax(0, 1fr))" }} role="radiogroup" aria-label="RPE real del bloque">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={result.rpe === n} aria-pressed={result.rpe === n}
                    onClick={() => onChange({ ...result, rpe: result.rpe === n ? null : n })}>{n}</button>
                ))}
              </div>
            </div>
            <div className="nf">
              <label htmlFor={`ad-${block.id}`}>Adaptaciones</label>
              <input id={`ad-${block.id}`} className="input" value={result.adaptations ?? ""} placeholder="Ej.: step-ups en lugar de box jumps"
                onChange={(e) => onChange({ ...result, adaptations: e.target.value || null })} />
            </div>
            <div className="nf">
              <label htmlFor={`no-${block.id}`}>Notas</label>
              <input id={`no-${block.id}`} className="input" value={result.notes ?? ""} onChange={(e) => onChange({ ...result, notes: e.target.value || null })} />
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Barra de guardado
// ---------------------------------------------------------------------
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export function SaveBar({ state, error, onSave, onDiscard, undo }: {
  state: SaveState; error: string | null; onSave: () => void; onDiscard: () => void;
  undo?: { label: string; run: () => void } | null;
}) {
  if (state === "idle" && !undo) return null;
  return (
    <div className={`save-bar ${state}`} role="status" aria-live="polite">
      <span className="save-msg">
        {state === "dirty" && <><Icon name="edit" />Cambios sin guardar</>}
        {state === "saving" && <><Icon name="sync" />Guardando…</>}
        {state === "saved" && <><Icon name="check" />Guardado</>}
        {state === "error" && <><Icon name="alert" />No se ha guardado{error ? `: ${error}` : ""}. Tus datos siguen aquí.</>}
        {state === "idle" && undo && <>{undo.label}</>}
      </span>
      <span className="row nowrap" style={{ gap: 6 }}>
        {undo && <button type="button" className="btn sm" onClick={undo.run}>Deshacer</button>}
        {(state === "dirty" || state === "error") && <button type="button" className="btn ghost sm" onClick={onDiscard}>Descartar</button>}
        {(state === "dirty" || state === "error" || state === "saving") && (
          <button type="button" className="btn primary sm" onClick={onSave} disabled={state === "saving"} aria-busy={state === "saving"}>
            {state === "error" ? "Reintentar" : "Guardar"}
          </button>
        )}
      </span>
    </div>
  );
}

