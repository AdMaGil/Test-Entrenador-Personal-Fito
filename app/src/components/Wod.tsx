import type { ReactNode } from "react";
import { fmtDayLong } from "../lib/dates";
import {
  BLOCK_TYPE_LABEL, describeBlockStructure, describeLoad, describeRpe, describeTarget, fmtSeconds,
  type WodBlock, type WodBlockType, type WodItem, type WodSpec, type WodTargetType,
} from "../lib/wod";
import { Icon } from "./icons";

// Todo el contenido del WOD se pinta como texto (React lo escapa): nunca como HTML.

export function PendingFlag({ children }: { children: ReactNode }) {
  return <span className="pending-flag"><Icon name="alert" />{children}</span>;
}

export function ModalityBadge({ modality }: { modality: WodSpec["modalidad"] }) {
  if (modality === "parejas") return <span className="badge pairs">Parejas</span>;
  if (modality === "individual") return <span className="badge">Individual</span>;
  return <span className="badge muted-badge">Modalidad sin indicar</span>;
}

export function WodItemLine({ item, showParticipant }: { item: WodItem; showParticipant: boolean }) {
  const target = describeTarget(item.objetivo);
  const load = describeLoad(item.carga);
  return (
    <li className="wod-item">
      <div className="wod-item-main">
        {showParticipant && item.participante && <span className="who" title="Etiqueta del WOD; no indica quién lo hace">{item.participante}</span>}
        <span className="name">{item.nombre}</span>
        {target && <span className="target num">{target}</span>}
      </div>
      {(load || item.equipamiento || item.alternativas?.length || item.notas) && (
        <div className="wod-item-sub">
          {load && <span>Carga prevista: <b>{load}</b></span>}
          {!load && item.equipamiento && <span>{item.equipamiento}</span>}
          {item.alternativas?.length ? <span>Alternativa: {item.alternativas.join(" / ")} <span className="muted">(sin decidir)</span></span> : null}
          {item.notas && <span>{item.notas}</span>}
        </div>
      )}
    </li>
  );
}

export function WodBlockCard({ block, index, modality, children }: {
  block: WodBlock; index: number; modality: WodSpec["modalidad"]; children?: ReactNode;
}) {
  if (block.tipo === "descanso") {
    return (
      <div className="wod-rest" role="group" aria-label="Descanso">
        <Icon name="clock" />
        <span><b>Descanso</b>{block.duracion_s !== null ? ` · ${fmtSeconds(block.duracion_s)}` : " · duración sin indicar"}</span>
        {block.notas && <span className="muted">{block.notas}</span>}
      </div>
    );
  }
  const structure = describeBlockStructure(block);
  return (
    <section className="wod-block" aria-label={`Bloque ${index + 1}: ${BLOCK_TYPE_LABEL[block.tipo]}`}>
      <header className="wod-block-head">
        <div className="row" style={{ gap: 8 }}>
          <span className="wod-type">{BLOCK_TYPE_LABEL[block.tipo]}</span>
          {block.titulo && <span className="wod-title">{block.titulo}</span>}
          {modality === "parejas" && <span className="badge pairs">Parejas</span>}
        </div>
        {structure.length > 0 && <div className="wod-structure">{structure.map((s) => <span key={s}>{s}</span>)}</div>}
      </header>
      {block.ejercicios.length > 0 ? (
        <ul className="wod-items">
          {block.ejercicios.map((it) => <WodItemLine key={it.id} item={it} showParticipant={modality === "parejas" || Boolean(it.participante)} />)}
        </ul>
      ) : <p className="small muted">Sin ejercicios indicados.</p>}
      {(block.rpe?.length || block.descanso || block.notas) && (
        <div className="wod-block-foot">
          {block.rpe?.length ? <span>RPE previsto: {block.rpe.map(describeRpe).join(" · ")}</span> : null}
          {block.descanso && (
            <span><Icon name="clock" /> Descanso {block.descanso.duracion_s !== null ? fmtSeconds(block.descanso.duracion_s) : "sin duración"}
              {block.descanso.ubicacion === "entre_rondas" ? " entre rondas" : block.descanso.ubicacion === "tras_bloque" ? " al terminar" : " · ubicación sin indicar"}</span>
          )}
          {block.notas && <span>{block.notas}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Calentamiento, ambigüedades, enfoque, transcripción y datos no reconocidos. */
export function WodExtras({ wod, position }: { wod: WodSpec; position: "before" | "after" }) {
  if (position === "before") {
    return (
      <>
        {wod.ambiguedades.length > 0 && (
          <div className="wod-ambig" role="note">
            <PendingFlag>Pendiente de revisar ({wod.ambiguedades.length})</PendingFlag>
            <ul>{wod.ambiguedades.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
        )}
        {wod.calentamiento && (
          <details className="disclosure">
            <summary><Icon name="chevron" className="ico chev" />Calentamiento{wod.calentamiento.rondas ? ` · ${wod.calentamiento.rondas} rondas` : ""}</summary>
            <ul className="wod-items">
              {wod.calentamiento.ejercicios.map((it) => <WodItemLine key={it.id} item={it} showParticipant={false} />)}
            </ul>
            {wod.calentamiento.notas && <p className="small ink2" style={{ marginBottom: 10 }}>{wod.calentamiento.notas}</p>}
          </details>
        )}
      </>
    );
  }
  return (
    <>
      {(wod.resumen_enfoque || wod.notas) && (
        <details className="disclosure">
          <summary><Icon name="chevron" className="ico chev" />Enfoque y notas</summary>
          {wod.resumen_enfoque && <p className="small ink2" style={{ whiteSpace: "pre-wrap" }}>{wod.resumen_enfoque}</p>}
          {wod.notas && <p className="small ink2" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{wod.notas}</p>}
        </details>
      )}
      {wod.transcripcion && (
        <details className="disclosure">
          <summary><Icon name="chevron" className="ico chev" />Transcripción original</summary>
          <pre className="wod-transcript">{wod.transcripcion}</pre>
        </details>
      )}
      {wod.no_reconocido.length > 0 && (
        <details className="disclosure">
          <summary><Icon name="chevron" className="ico chev" />No reconocido ({wod.no_reconocido.length}) · conservado para revisión</summary>
          <ul className="wod-unrec">{wod.no_reconocido.map((u, i) => <li key={i}><span className="mono">{u.ruta}</span>: {u.valor}</li>)}</ul>
        </details>
      )}
    </>
  );
}

export function WodSummaryLine({ wod }: { wod: WodSpec }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <ModalityBadge modality={wod.modalidad} />
      {wod.fecha && <span className="badge">{fmtDayLong(wod.fecha)}</span>}
      <span className="small muted">{wod.bloques.filter((b) => b.tipo !== "descanso").length} bloque(s)</span>
    </div>
  );
}

/** Vista completa de solo lectura. */
export function WodView({ wod, renderBlockExtra }: { wod: WodSpec; renderBlockExtra?: (b: WodBlock) => ReactNode }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <WodExtras wod={wod} position="before" />
      {wod.bloques.map((b, i) => (
        <WodBlockCard key={b.id} block={b} index={i} modality={wod.modalidad}>{renderBlockExtra?.(b)}</WodBlockCard>
      ))}
      <WodExtras wod={wod} position="after" />
    </div>
  );
}

// ---------------------------------------------------------------------
// Editor de la previsualización: corrige lo importante sin tocar JSON
// ---------------------------------------------------------------------
const BLOCK_TYPES: WodBlockType[] = ["emom", "amrap", "for_time", "rondas", "descanso", "otro"];
const TARGET_TYPES: { v: WodTargetType | ""; l: string }[] = [
  { v: "", l: "Sin indicar" }, { v: "reps", l: "reps" }, { v: "segundos", l: "s" }, { v: "metros", l: "m" },
  { v: "calorias", l: "cal" }, { v: "max_reps", l: "máx. reps" }, { v: "max_calorias", l: "máx. cal" }, { v: "otro", l: "otro" },
];

const numOrNull = (v: string): number | null => {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const minToSec = (v: string) => { const n = numOrNull(v); return n === null ? null : Math.round(n * 60); };
const secToMin = (s: number | null) => (s === null ? "" : String(Math.round((s / 60) * 100) / 100));

export function WodEditor({ value, onChange }: { value: WodSpec; onChange: (w: WodSpec) => void }) {
  const setBlock = (i: number, patch: Partial<WodBlock>) =>
    onChange({ ...value, bloques: value.bloques.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const setItem = (bi: number, ii: number, patch: Partial<WodItem>) =>
    setBlock(bi, { ejercicios: value.bloques[bi].ejercicios.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="wod-name">Nombre</label>
          <input id="wod-name" className="input" value={value.nombre ?? ""} onChange={(e) => onChange({ ...value, nombre: e.target.value || null })} placeholder="Ej.: HYROX" />
        </div>
        <div className="field">
          <label htmlFor="wod-date">Fecha del WOD</label>
          <input id="wod-date" className="input" type="date" value={value.fecha ?? ""} onChange={(e) => onChange({ ...value, fecha: e.target.value || null })} />
        </div>
        <div className="field">
          <label htmlFor="wod-mod">Modalidad</label>
          <select id="wod-mod" className="input" value={value.modalidad ?? ""} onChange={(e) => onChange({ ...value, modalidad: (e.target.value || null) as WodSpec["modalidad"] })}>
            <option value="">Sin indicar</option><option value="individual">Individual</option><option value="parejas">Parejas</option>
          </select>
        </div>
      </div>

      {value.ambiguedades.length > 0 && (
        <div className="wod-ambig">
          <PendingFlag>Pendiente de revisar</PendingFlag>
          <ul>
            {value.ambiguedades.map((a, i) => (
              <li key={i} className="row between nowrap" style={{ alignItems: "flex-start" }}>
                <span>{a}</span>
                <button type="button" className="btn ghost sm" onClick={() => onChange({ ...value, ambiguedades: value.ambiguedades.filter((_, j) => j !== i) })}
                  aria-label={`Marcar como resuelta: ${a}`}>Resuelta</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {value.bloques.map((b, bi) => (
        <fieldset key={b.id} className="wod-block edit">
          <legend className="sr-only">Bloque {bi + 1}</legend>
          <div className="wod-edit-grid">
            <div className="field">
              <label htmlFor={`bt-${b.id}`}>Tipo</label>
              <select id={`bt-${b.id}`} className="input" value={b.tipo} onChange={(e) => setBlock(bi, { tipo: e.target.value as WodBlockType })}>
                {BLOCK_TYPES.map((t) => <option key={t} value={t}>{BLOCK_TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`bn-${b.id}`}>Título</label>
              <input id={`bn-${b.id}`} className="input" value={b.titulo ?? ""} onChange={(e) => setBlock(bi, { titulo: e.target.value || null })} />
            </div>
            {b.tipo !== "descanso" && (
              <div className="field">
                <label htmlFor={`br-${b.id}`}>Rondas</label>
                <input id={`br-${b.id}`} className="input" inputMode="numeric" value={b.rondas ?? ""} onChange={(e) => setBlock(bi, { rondas: numOrNull(e.target.value) })} />
              </div>
            )}
            <div className="field">
              <label htmlFor={`bd-${b.id}`}>Duración (min)</label>
              <input id={`bd-${b.id}`} className="input" inputMode="decimal" value={secToMin(b.duracion_s)} onChange={(e) => setBlock(bi, { duracion_s: minToSec(e.target.value) })} />
            </div>
            {b.tipo !== "descanso" && (
              <div className="field">
                <label htmlFor={`bl-${b.id}`}>Límite confirmado (min)</label>
                <input id={`bl-${b.id}`} className="input" inputMode="decimal" value={secToMin(b.limite_tiempo_s)} onChange={(e) => setBlock(bi, { limite_tiempo_s: minToSec(e.target.value) })} />
              </div>
            )}
            {b.tipo !== "descanso" && (
              <div className="field">
                <label htmlFor={`bi-${b.id}`}>Indicación sin confirmar</label>
                <input id={`bi-${b.id}`} className="input" value={b.indicacion_tiempo ?? ""} onChange={(e) => setBlock(bi, { indicacion_tiempo: e.target.value || null })} placeholder="Ej.: 36'" />
              </div>
            )}
          </div>
          {b.tipo !== "descanso" && (
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              {b.ejercicios.map((it, ii) => (
                <div key={it.id} className="wod-edit-item">
                  <div className="field grow">
                    <label htmlFor={`in-${it.id}`}>Ejercicio</label>
                    <input id={`in-${it.id}`} className="input" value={it.nombre} onChange={(e) => setItem(bi, ii, { nombre: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`iv-${it.id}`}>Objetivo</label>
                    <div className="row nowrap" style={{ gap: 4 }}>
                      <input id={`iv-${it.id}`} className="input" style={{ width: 72 }} inputMode="decimal"
                        disabled={Boolean(it.objetivo?.por_ronda?.length || it.objetivo?.alternativas?.length)}
                        value={it.objetivo?.valor ?? ""}
                        onChange={(e) => setItem(bi, ii, { objetivo: { ...(it.objetivo ?? emptyTarget()), valor: numOrNull(e.target.value) } })} />
                      <select className="input" style={{ width: 96 }} aria-label="Unidad del objetivo" value={it.objetivo?.tipo ?? ""}
                        onChange={(e) => setItem(bi, ii, { objetivo: { ...(it.objetivo ?? emptyTarget()), tipo: (e.target.value || null) as WodTargetType | null } })}>
                        {TARGET_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                      </select>
                    </div>
                    {(it.objetivo?.por_ronda?.length || it.objetivo?.alternativas?.length) ? <span className="hint">{describeTarget(it.objetivo)}</span> : null}
                  </div>
                  <div className="field">
                    <label htmlFor={`ik-${it.id}`}>Carga prevista</label>
                    <div className="row nowrap" style={{ gap: 4 }}>
                      <input id={`ik-${it.id}`} className="input" style={{ width: 52 }} inputMode="numeric" aria-label="Número de implementos"
                        placeholder="nº" value={it.carga?.implementos ?? ""}
                        onChange={(e) => setItem(bi, ii, { carga: { ...(it.carga ?? emptyLoad()), implementos: numOrNull(e.target.value) } })} />
                      <span className="muted">×</span>
                      <input className="input" style={{ width: 68 }} inputMode="decimal" aria-label="Kilos por implemento" placeholder="kg"
                        value={it.carga?.kg ?? ""}
                        onChange={(e) => setItem(bi, ii, { carga: { ...(it.carga ?? emptyLoad()), kg: numOrNull(e.target.value), modo: it.carga?.modo ?? "por_implemento" } })} />
                      <span className="muted small">kg</span>
                    </div>
                  </div>
                  <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-end" }}
                    onClick={() => setBlock(bi, { ejercicios: b.ejercicios.filter((_, j) => j !== ii) })} aria-label={`Quitar ${it.nombre}`}>
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
              <div>
                <button type="button" className="btn sm" onClick={() => setBlock(bi, { ejercicios: [...b.ejercicios, {
                  id: uniqueItemId(value), nombre: "", participante: null, objetivo: null, carga: null, equipamiento: null, alternativas: null, notas: null,
                }] })}><Icon name="plus" />Añadir ejercicio</button>
              </div>
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn ghost sm" onClick={() => onChange({ ...value, bloques: value.bloques.filter((_, j) => j !== bi) })}>
              <Icon name="trash" />Quitar bloque
            </button>
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function emptyTarget() { return { tipo: null, valor: null, por_ronda: null, alternativas: null, por_lado: null, texto: null }; }
function emptyLoad() { return { texto: null, kg: null, implementos: null, modo: null }; }
function uniqueItemId(w: WodSpec): string {
  const ids = new Set([...w.bloques.flatMap((b) => b.ejercicios.map((e) => e.id)), ...(w.calentamiento?.ejercicios.map((e) => e.id) ?? [])]);
  let n = ids.size + 1;
  while (ids.has(`e${n}`)) n++;
  return `e${n}`;
}
