import { useState, type ReactNode } from "react";
import { fmtKg, totalLoadKg } from "../lib/loads";
import type { BlockResult, Feedback, ResultMetrics, StrengthSet, Workout } from "../lib/types";
import {
  BLOCK_TYPE_LABEL, describeLoad, isScoredBlock, loadedItems, structureSummary,
  type WodBlock, type WodItem, type WodTarget,
} from "../lib/wod";

/** Objetivo en formato corto de pizarra: «10», «200/150 m», «2-4-6», «30''», «Máx. cal». */
function shortTarget(t: WodTarget | null): string {
  if (!t) return "";
  const unit = t.tipo === "metros" ? " m" : t.tipo === "calorias" ? " cal" : "";
  if (t.tipo === "max_reps") return "Máx.";
  if (t.tipo === "max_calorias") return "Máx. cal";
  if (t.por_ronda?.length) return t.por_ronda.join("-");
  if (t.alternativas?.length) return `${t.alternativas.join("/")}${unit}`;
  if (t.valor !== null) {
    if (t.tipo === "segundos") return t.valor >= 60 && t.valor % 60 === 0 ? `${t.valor / 60}'` : `${t.valor}''`;
    return `${t.valor}${unit}${t.por_lado ? " por lado" : ""}`;
  }
  return t.texto ?? "";
}
import { Icon } from "./icons";
import { NumField, TimeField, type LocalSet } from "./SessionLog";

/**
 * Registro rápido: solo lo que alimenta la evolución.
 *   1. Resultado de los bloques puntuables (AMRAP → rondas + reps; For Time → tiempo).
 *   2. Peso usado en los ejercicios con carga.
 *   3. RPE y nota de la sesión.
 * Nada se rellena a partir de la pauta: los campos empiezan vacíos.
 */
export function QuickLog({ w, sets, getResult, setResult, onWeight, f, setF, renderLast, title }: {
  w: Workout;
  sets: LocalSet[];
  getResult: (blockRef: string) => BlockResult;
  setResult: (r: BlockResult) => void;
  onWeight: (block: WodBlock, item: WodItem, patch: Partial<StrengthSet>) => void;
  f: Feedback | null;
  setF: (f: Feedback) => void;
  renderLast: (exercise: string, highlight: boolean) => ReactNode;
  /** Título ya visible en la página: si coincide con el resumen de estructura, no se repite. */
  title?: string;
}) {
  const spec = w.spec;
  const scored = spec.bloques.filter(isScoredBlock);
  const loaded = loadedItems(spec);
  const pairs = spec.modalidad === "parejas";
  let n = 0;
  return (
    <div className="quick">
      {(structureSummary(spec) !== title || pairs) && (
        <p className="quick-structure">{structureSummary(spec) !== title ? structureSummary(spec) : null}{pairs && <span className="badge pairs" style={{ marginLeft: 8 }}>Parejas</span>}</p>
      )}

      {scored.length > 0 && (
        <section className="quick-section" aria-label="Resultados">
          {scored.map((b) => {
            n++;
            return <ScoredBlock key={b.id} n={n} b={b} pairs={pairs} r={getResult(b.id)} onChange={setResult} />;
          })}
        </section>
      )}

      {loaded.length > 0 && (
        <section className="quick-section" aria-label="Cargas">
          <h3 className="quick-h">Peso usado</h3>
          {loaded.map(({ block, item }) => {
            const mine = sets.filter((s) => s.workout_id === w.id && s.item_ref === item.id);
            return (
              <div key={item.id} className="quick-load">
                <div className="quick-load-name">
                  <span>{item.repetir_carga_anterior && <span className="star" title="La pizarra pide repetir la carga anterior">★</span>}{mine[0]?.exercise || item.nombre}</span>
                  {item.carga?.texto && !item.carga.kg && <span className="muted small"> · pauta {item.carga.texto}</span>}
                  {item.carga?.kg ? <span className="muted small"> · pauta {describeLoad(item.carga)}</span> : null}
                </div>
                {mine.length > 1
                  ? <span className="small ink2">{mine.length} series · {mine.map((s) => (totalLoadKg(s) !== null ? `${fmtKg(totalLoadKg(s) as number)} kg` : "—")).join(", ")} <span className="muted">(edítalas en el detalle)</span></span>
                  : <WeightInput set={mine[0]} item={item} onChange={(p) => onWeight(block, item, p)} />}
                {renderLast(mine[0]?.exercise || item.nombre, Boolean(item.repetir_carga_anterior))}
              </div>
            );
          })}
        </section>
      )}

      {f && (
        <section className="quick-section" aria-label="Sesión">
          <div className="nf">
            <span className="nf-label">RPE de la sesión</span>
            <div className="scale" style={{ gridTemplateColumns: "repeat(10, minmax(0, 1fr))" }} role="radiogroup" aria-label="RPE de la sesión">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={f.rpe === v} aria-pressed={f.rpe === v}
                  onClick={() => setF({ ...f, rpe: f.rpe === v ? null : v })}>{v}</button>
              ))}
            </div>
          </div>
          <div className="nf" style={{ marginTop: 8 }}>
            <label htmlFor={`qn-${w.id}`}>Nota (opcional)</label>
            <input id={`qn-${w.id}`} className="input" value={f.notes ?? ""} placeholder="Sensaciones, adaptaciones…"
              onChange={(e) => setF({ ...f, notes: e.target.value || null })} />
          </div>
        </section>
      )}
    </div>
  );
}

function hasAny(m: ResultMetrics): boolean {
  return Object.values(m).some((v) => typeof v === "number");
}

function ScoredBlock({ n, b, pairs, r, onChange }: { n: number; b: WodBlock; pairs: boolean; r: BlockResult; onChange: (r: BlockResult) => void }) {
  // En parejas, lo puntuable es el resultado del equipo; tu contribución se registra en el detalle
  const key: "team" | "personal" = pairs ? "team" : "personal";
  const m = r[key];
  const [capped, setCapped] = useState(b.tipo === "for_time" && m.time_s == null && (m.rounds != null || m.reps != null));
  const set = (patch: ResultMetrics) => {
    const next = { ...m, ...patch };
    onChange({ ...r, [key]: next, status: hasAny(next) ? "realizado" : r.status === "no_realizado" ? "no_realizado" : null });
  };
  const dur = b.duracion_s ? ` ${Math.round(b.duracion_s / 60)}'` : "";
  const title = b.titulo && !/^(for time|amrap)/i.test(b.titulo) ? b.titulo : `${BLOCK_TYPE_LABEL[b.tipo]}${b.tipo === "amrap" ? dur : ""}`;
  const items = b.ejercicios.map((it) => [shortTarget(it.objetivo), it.nombre].filter(Boolean).join(" ")).join(" · ");
  return (
    <div className={`quick-block ${r.status === null ? "pending" : ""}`}>
      <div className="quick-block-head">
        <span className="quick-n">{n}</span>
        <div style={{ minWidth: 0 }}>
          <div className="quick-block-title">{title}{b.rondas && b.tipo === "for_time" ? ` · ${b.rondas} rondas` : ""}{b.limite_tiempo_s ? ` · TC ${Math.round(b.limite_tiempo_s / 60)}'` : ""}</div>
          {items && <div className="quick-block-items">{items}</div>}
        </div>
      </div>
      {r.status === "no_realizado" ? (
        <div className="row small"><span className="muted">No realizado</span>
          <button type="button" className="btn ghost sm" onClick={() => onChange({ ...r, status: null })}>Deshacer</button></div>
      ) : (
        <div className="metrics-row">
          {b.tipo === "for_time" && !capped && <TimeField label={pairs ? "Tiempo del equipo" : "Tiempo"} value={m.time_s} onChange={(v) => set({ time_s: v })} />}
          {(b.tipo === "amrap" || capped) && (
            <>
              <NumField label={pairs ? "Rondas (equipo)" : "Rondas"} int value={m.rounds} onChange={(v) => set({ rounds: v })} width={56} />
              <NumField label="+ reps" int value={m.reps} onChange={(v) => set({ reps: v })} width={56} />
            </>
          )}
          <div className="quick-block-actions">
            {b.tipo === "for_time" && (
              <label className="radio small"><input type="checkbox" checked={capped}
                onChange={(e) => { setCapped(e.target.checked); set(e.target.checked ? { time_s: null } : { rounds: null, reps: null }); }} />No terminé</label>
            )}
            <button type="button" className="btn ghost sm" onClick={() => onChange({ ...r, status: "no_realizado", personal: {}, team: {} })}>No lo hice</button>
          </div>
        </div>
      )}
    </div>
  );
}

function WeightInput({ set, item, onChange }: { set: StrengthSet | undefined; item: WodItem; onChange: (p: Partial<StrengthSet>) => void }) {
  // La interpretación sale de lo ya registrado o, si no hay nada, de la carga explícita del WOD («2DB»): nunca del nombre
  const perImpl = set ? set.load_mode === "por_implemento" : item.carga?.modo === "por_implemento" || (item.carga?.implementos ?? 0) > 1;
  const impl = set?.implements ?? item.carga?.implementos ?? null;
  if (perImpl) {
    const total = impl && set?.load_per_implement_kg ? impl * set.load_per_implement_kg : null;
    return (
      <div className="quick-weight">
        <NumField hideLabel label={impl && impl > 1 ? `Kg de cada una (${impl})` : "Kg"} unit={impl && impl > 1 ? `kg × ${impl}` : "kg"} value={set?.load_per_implement_kg}
          onChange={(v) => onChange({ load_mode: "por_implemento", implements: impl ?? 1, load_per_implement_kg: v && v > 0 ? v : null })} />
        {total !== null && impl && impl > 1 && <span className="nf-hint calc">= {fmtKg(total)} kg en total</span>}
      </div>
    );
  }
  return (
    <div className="quick-weight">
      <NumField hideLabel label="Kg" unit="kg" value={set?.weight_kg}
        onChange={(v) => onChange({ load_mode: !set || set.load_mode === "sin_carga" ? "total" : set.load_mode ?? null, weight_kg: v && v > 0 ? v : null })} />
      {set && set.load_mode == null && set.weight_kg != null && <span className="nf-hint warn">Registro antiguo: aclara si es total o por implemento en el detalle</span>}
    </div>
  );
}

export function QuickHint() {
  return <p className="tiny muted"><Icon name="info" /> Solo se pide lo que sirve para tu evolución. La pauta completa y el registro por series están en «Ver WOD completo».</p>;
}
