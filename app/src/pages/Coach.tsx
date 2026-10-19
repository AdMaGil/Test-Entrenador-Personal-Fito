import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/icons";
import { PageHead } from "../components/Layout";
import { PlannedForm, SessionDetails } from "../components/Sessions";
import { Card, Empty, IconChip, type Tone } from "../components/ui";
import { useApp } from "../data/AppData";
import { coachAiEnabled, supabase } from "../data/supabaseClient";
import { explainProgress, explainWeight, reorganizeWeek, suggestToday, type CoachContext } from "../lib/coach";
import { addDays, DOW_LABELS, fmtDay, fmtDayLong, weekDays } from "../lib/dates";
import { SPORT_LABEL } from "../lib/sports";
import type { CoachPayload, PlannedDraft, PlannedSession } from "../lib/types";

const ACTIONS = [
  { key: "30", label: "Hoy tengo 30 minutos", icon: "clock", tone: "info" },
  { key: "casa", label: "Adapta la sesión a casa", icon: "home", tone: "info" },
  { key: "sueno", label: "Esta noche he dormido poco", icon: "moon", tone: "warn" },
  { key: "emtb", label: "Quiero salir con la e-MTB", icon: "bike", tone: "info" },
  { key: "semana", label: "Reorganiza mi semana", icon: "calendar", tone: "warn" },
  { key: "evolucion", label: "Explícame cómo voy evolucionando", icon: "chart", tone: "info" },
] as const satisfies readonly { key: string; label: string; icon: IconName; tone: Tone }[];

function ProposalCard({ p }: { p: PlannedDraft }) {
  const { run } = useApp();
  const [done, setDone] = useState<null | string>(null);
  const [edit, setEdit] = useState(false);
  if (done) return <p className="small muted">{done}</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <SessionDetails s={p} />
      <div className="row">
        <button className="btn primary sm" onClick={async () => { const ok = await run((r) => r.savePlanned({ ...p, status: "planificada" }), "Añadida al calendario"); if (ok) setDone(`Añadida al calendario el ${fmtDay(p.date)}.`); }}>Añadir al calendario</button>
        <button className="btn sm" onClick={async () => { const ok = await run((r) => r.savePlanned({ ...p, status: "propuesta" }), "Guardada como sugerencia"); if (ok) setDone("Guardada como sugerencia pendiente en el calendario."); }}>Guardar como sugerencia</button>
        <button className="btn sm" onClick={() => setEdit(true)}><Icon name="edit" />Revisar y editar</button>
        <button className="btn ghost sm" onClick={() => setDone("Propuesta descartada.")}>Descartar</button>
      </div>
      {edit && <PlannedForm initial={p} title="Revisar propuesta" onClose={() => setEdit(false)} />}
    </div>
  );
}

function ChangesCard({ changes }: { changes: NonNullable<CoachPayload["changes"]> }) {
  const { run, data } = useApp();
  const [sel, setSel] = useState<Set<string>>(new Set(changes.map((c) => c.id)));
  const [applied, setApplied] = useState(false);
  if (applied) return <p className="small muted">Cambios aplicados.</p>;
  const apply = async () => {
    const ok = await run(async (r) => {
      for (const c of changes.filter((x) => sel.has(x.id))) {
        const s = data.planned.find((p) => p.id === c.id);
        if (s) await r.savePlanned({ ...s, date: c.to });
      }
    }, "Semana reorganizada");
    if (ok !== undefined) setApplied(true);
  };
  return (
    <div className="proposal">
      {changes.map((c) => (
        <label key={c.id} className="row small">
          <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(c.id); else n.delete(c.id); setSel(n); }} />
          «{c.title}»: {fmtDayLong(c.from)} → <b>{fmtDayLong(c.to)}</b>
        </label>
      ))}
      <div className="row"><button className="btn primary sm" disabled={!sel.size} onClick={apply}>Aplicar cambios seleccionados</button></div>
    </div>
  );
}

export default function Coach() {
  const { data, today, run, repo, mode } = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<PlannedSession | null>(null);
  const ctx: CoachContext = { today, profile: data.profile, activities: data.activities, wellness: data.wellness, checkins: data.checkins, planned: data.planned };
  const p = data.profile;
  const weekPlan = useMemo(() => data.planned.filter((s) => s.date >= weekDays(today)[0] && s.date <= addDays(weekDays(today)[0], 13))
    .sort((a, b) => a.date.localeCompare(b.date)), [data.planned, today]);

  const respond = async (userText: string, content: string, payload: CoachPayload | null) => {
    await run(async (r) => { await r.addCoachMessage("user", userText); await r.addCoachMessage("assistant", content, payload); });
  };

  const doAction = async (key: (typeof ACTIONS)[number]["key"]) => {
    const label = ACTIONS.find((a) => a.key === key)!.label;
    if (key === "semana") {
      const r = reorganizeWeek(ctx);
      const content = [r.changes.length ? `Propongo ${r.changes.length} cambio(s). Revísalos antes de aplicarlos:` : "No propongo mover ninguna sesión.", ...r.notes].join("\n");
      return respond(label, content, { changes: r.changes, rule: "Reorganización por días disponibles y sin dos sesiones intensas seguidas" });
    }
    if (key === "evolucion") {
      const lines = explainProgress(ctx);
      const w = explainWeight(data.measurements);
      return respond(label, [...lines, ...(w ? [w] : [])].join("\n\n"), { rule: "Resumen descriptivo de tus datos" });
    }
    const overrides = key === "30" ? { minutes: 30 } : key === "casa" ? { location: "casa" as const } : key === "sueno" ? { sleptBadly: true } : { sport: "emtb" as const };
    const s = suggestToday(ctx, overrides);
    if (s.kind === "insuficiente" || !s.session) return respond(label, s.reasons.join("\n"), null);
    const session = { ...s.session, status: "propuesta" as const, origin: "reglas" as const, date: today };
    return respond(label, `Propuesta para hoy (${s.rule.toLowerCase()}). Revísala antes de añadirla:`, { proposals: [session], rule: s.rule, data_used: s.dataUsed });
  };

  const send = async () => {
    const q = text.trim();
    if (!q) return;
    setText("");
    if (!coachAiEnabled || mode !== "real" || !supabase) {
      return respond(q, "El asistente conversacional con IA no está configurado, así que no puedo interpretar texto libre. Puedo ayudarte con las acciones de arriba, que usan reglas explícitas, y siempre puedes planificar manualmente desde el calendario.", null);
    }
    setBusy(true);
    try {
      await repo?.addCoachMessage("user", q);
      // La llamada al proveedor de IA se hace en el servidor (función «coach»), nunca desde el navegador.
      const { data: res, error } = await supabase.functions.invoke("coach", { body: { message: q, today } });
      if (error) throw error;
      await repo?.addCoachMessage("assistant", String(res?.content ?? "Sin respuesta"), (res?.payload ?? null) as CoachPayload | null);
    } catch (e) {
      await repo?.addCoachMessage("assistant", `No se pudo contactar con el asistente: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      await run(async () => undefined);
    }
  };

  return (
    <>
      <PageHead title="Mi entrenador" sub={coachAiEnabled ? "Propuestas por reglas e IA configurada en el servidor" : "Propuestas basadas en reglas explícitas · IA no configurada"} />
      <div className="split">
        <div className="stack">
          <Card title="Acciones rápidas" icon="bolt" tone="accent">
            <div className="action-tiles">
              {ACTIONS.map((a) => (
                <button key={a.key} className="action-tile" onClick={() => doAction(a.key)}>
                  <IconChip icon={a.icon} tone={a.tone} />
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
            <p className="tiny muted" style={{ marginTop: 8 }}>Las propuestas nunca se añaden solas al calendario: revísalas y decide.</p>
          </Card>

          <Card title="Conversación" icon="coach" tone="violet" action={data.coachMessages.length ? <button className="btn ghost sm" onClick={() => confirm("¿Borrar la conversación?") && run((r) => r.clearCoachMessages())}>Borrar</button> : null}>
            <div className="chat" aria-live="polite">
              {data.coachMessages.length ? data.coachMessages.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  {m.content}
                  {m.payload?.proposals?.map((pp, i) => <div key={i} style={{ marginTop: 10 }}><ProposalCard p={pp} /></div>)}
                  {m.payload?.changes && m.payload.changes.length > 0 && <div style={{ marginTop: 10 }}><ChangesCard changes={m.payload.changes} /></div>}
                  {m.payload?.data_used && m.payload.data_used.length > 0 && <p className="tiny muted" style={{ marginTop: 6 }}>Datos usados: {m.payload.data_used.join(" · ")}</p>}
                </div>
              )) : <Empty title="Sin conversación todavía">Usa una acción rápida para empezar.</Empty>}
            </div>
            <div className="row nowrap" style={{ marginTop: 12 }}>
              <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={coachAiEnabled ? "Escribe tu pregunta…" : "Texto libre (requiere IA configurada)"} aria-label="Mensaje" />
              <button className="btn primary" onClick={send} disabled={busy || !text.trim()}>Enviar</button>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Tu configuración" icon="settings" tone="info" action={<Link to="/ajustes" className="btn ghost sm">Editar<Icon name="chevron" /></Link>}>
            <dl className="small" style={{ margin: 0, display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 10px" }}>
              <dt className="muted">Objetivos</dt><dd style={{ margin: 0 }}>{p?.goals || "Sin configurar"}</dd>
              <dt className="muted">Días disponibles</dt><dd style={{ margin: 0 }}>{p?.available_days?.length ? p.available_days.map((d) => DOW_LABELS[d - 1]).join(", ") : "Sin configurar"}</dd>
              <dt className="muted">Duración habitual</dt><dd style={{ margin: 0 }}>{p?.session_minutes_default ? `${p.session_minutes_default} min` : "Sin configurar (se usan 45 min)"}</dd>
              <dt className="muted">Prioridad</dt><dd style={{ margin: 0 }}>{p?.sport_priority?.map((s) => SPORT_LABEL[s]).join(" › ") || "Sin configurar"}</dd>
              <dt className="muted">Material</dt><dd style={{ margin: 0 }}>{p?.equipment?.length ? p.equipment.join(", ") : "Sin configurar"}</dd>
              <dt className="muted">Limitaciones</dt><dd style={{ margin: 0 }}>{p?.limitations || "Ninguna indicada"}</dd>
            </dl>
          </Card>
          <Card title="Plan de estas dos semanas" icon="calendar" tone="violet">
            {weekPlan.length ? weekPlan.map((s) => (
              <div key={s.id} className="row between" style={{ padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
                <span className="small"><b>{fmtDay(s.date)}</b> · {s.title} <span className="muted">({s.status === "propuesta" ? "sugerencia" : s.status})</span></span>
                <button className="btn ghost sm" onClick={() => setEdit(s)} aria-label="Editar sesión"><Icon name="edit" /></button>
              </div>
            )) : <p className="small muted">Sin sesiones planificadas.</p>}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => doAction("semana")}>Reorganiza mi semana</button>
              <Link className="btn sm" to="/calendario">Ir al calendario</Link>
            </div>
          </Card>
          <Card title="Cómo funcionan las sugerencias" icon="info" tone="info">
            <ul className="reasons small">
              <li>Fatiga alta o energía baja registradas hoy → sesión suave (descanso activo si la fatiga es máxima).</li>
              <li>Dos o más días seguidos de intensidad alta (≥20 % del tiempo en Z4+) → sesión suave.</li>
              <li>Ayer intensidad alta → hoy como máximo moderada.</li>
              <li>Menos de 6 h de sueño o «he dormido poco» → baja un nivel la intensidad.</li>
              <li>HRV por debajo de tu propio rango → como máximo moderada (es un dato, no un diagnóstico).</li>
              <li>Deporte: el prioritario que lleve más días sin practicarse.</li>
            </ul>
          </Card>
        </div>
      </div>
      {edit && <PlannedForm initial={edit} title="Editar sesión" onClose={() => setEdit(null)} />}
    </>
  );
}
