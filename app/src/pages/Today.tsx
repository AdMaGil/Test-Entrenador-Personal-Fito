import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/icons";
import { PageHead, SyncStatus } from "../components/Layout";
import { ActivityRow, PlannedForm, SessionDetails, StructureBar, intensityLabel, newDraft } from "../components/Sessions";
import { Card, Empty, Field, Modal, Scale, SportChip, Stat } from "../components/ui";
import { WodImportModal } from "../components/WodImport";
import { DoneToday, GoalsModal, GoalsRow, RecoveryCard, WeightGoalCard } from "../components/Dashboard";
import { activityPending, activityWodInfo, describePending, hasPending, unlinkedWorkouts } from "../lib/pending";
import { useApp } from "../data/AppData";
import { suggestToday, type Suggestion } from "../lib/coach";
import { addDays, diffDays, dowShort, fmtDay, fmtDayLong, weekDays } from "../lib/dates";
import { fmtDuration, fmtNum, isNum } from "../lib/format";
import {
  consecutiveHardDays, inRange, personalBaseline, realWeights, summarize, weekSummary,
} from "../lib/metrics";
import { SPORT_SHORT, SPORTS, sportColor } from "../lib/sports";
import type { Checkin, PlannedDraft, PlannedSession, Sport } from "../lib/types";

const SORENESS = ["ninguna", "lumbar", "rodillas", "hombros", "cuello", "cadera", "gemelos", "otra"];

/** Saludo según la hora local (zona horaria del perfil), sin inventar nada: solo franjas horarias. */
function greeting(tz: string): string {
  const hour = Number(new Intl.DateTimeFormat("es-ES", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
  if (hour < 6) return "Buenas noches";
  if (hour < 13) return "Buenos días";
  if (hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

function CheckinCard() {
  const { data, today, run } = useApp();
  const existing = data.checkins.find((c) => c.date === today);
  const [c, setC] = useState<Checkin>(existing ?? { date: today, energy: null, fatigue: null, soreness: [], sensations: null });
  const toggle = (s: string) => setC((x) => {
    if (s === "ninguna") return { ...x, soreness: x.soreness.includes("ninguna") ? [] : ["ninguna"] };
    const without = x.soreness.filter((y) => y !== "ninguna");
    return { ...x, soreness: without.includes(s) ? without.filter((y) => y !== s) : [...without, s] };
  });
  return (
    <Card title="¿Cómo te encuentras hoy?" icon="info" tone="ok" action={existing ? <span className="badge manual">Registrado</span> : <span className="small muted">Pendiente</span>}>
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Energía"><Scale name="Energía" value={c.energy} onChange={(v) => setC({ ...c, energy: v })} labels={["Muy baja", "Baja", "Normal", "Alta", "Muy alta"]} /></Field>
        <Field label="Fatiga"><Scale name="Fatiga" value={c.fatigue} onChange={(v) => setC({ ...c, fatigue: v })} labels={["Ninguna", "Leve", "Moderada", "Alta", "Máxima"]} /></Field>
        <div className="field">
          <span className="label">Molestias</span>
          <div className="row" style={{ gap: 6 }}>
            {SORENESS.map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={c.soreness.includes(s)} onClick={() => toggle(s)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <Field label="Sensaciones (opcional)">
          <input className="input" value={c.sensations ?? ""} onChange={(e) => setC({ ...c, sensations: e.target.value || null })} placeholder="Ej.: piernas cargadas tras la salida del sábado" />
        </Field>
        <div className="row">
          <button className="btn primary" onClick={() => run((r) => r.saveCheckin(c), "Registro guardado")}>Guardar registro</button>
        </div>
      </div>
    </Card>
  );
}

function TodayHero({ s, onAdapt, optional = false }: { s: Suggestion; onAdapt: (o: Parameters<typeof suggestToday>[1]) => void; optional?: boolean }) {
  const { theme, run, today } = useApp();
  const [view, setView] = useState(false);
  const [edit, setEdit] = useState<PlannedDraft | null>(null);
  const [adaptOpen, setAdaptOpen] = useState(false);

  if (s.kind === "insuficiente" || !s.session) {
    return (
      <Card className="hero">
        <div className="hero-inner">
          <span className="small muted">Tu entrenamiento de hoy</span>
          <div className="hero-title">No hay datos suficientes para sugerir una sesión</div>
          <ul className="reasons">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <div className="row"><button className="btn primary" onClick={() => setEdit(newDraft(today))}><Icon name="plus" />Planificar manualmente</button></div>
        </div>
        {edit && <PlannedForm initial={edit} title="Planificar sesión" onClose={() => setEdit(null)} />}
      </Card>
    );
  }
  const ses = s.session;
  const isPlanned = s.kind === "planificada";
  return (
    <Card className="hero">
      <span className="hero-rail" style={{ background: sportColor(ses.category, theme) }} />
      <div className="hero-inner">
        <div className="row between">
          <span className="small muted">{optional ? (isPlanned ? "También planificada hoy" : "Opcional: otra sesión") : "Tu entrenamiento de hoy"}</span>
          <span className="row" style={{ gap: 6 }}>
            <SportChip cat={ses.category} />
            <span className={`badge ${isPlanned ? "" : "estimado"}`}>{isPlanned ? "Planificada" : "Sugerencia por reglas · sin añadir"}</span>
          </span>
        </div>
        <div className="hero-title">{ses.title}</div>
        <div className="hero-meta">
          <span><span className="big">{ses.duration_min ?? "–"}</span> <span className="muted">min</span></span>
          <span className="ink2">Intensidad <b>{intensityLabel(ses.intensity)}</b></span>
          {ses.objective && <span className="ink2" style={{ flexBasis: "100%" }}>{ses.objective}</span>}
        </div>
        <StructureBar session={ses} />
        <ul className="reasons" aria-label="Por qué esta sesión">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        {s.dataUsed.length > 0 && <p className="tiny muted">Datos usados: {s.dataUsed.join(" · ")}. Regla aplicada: {s.rule}.</p>}
        <div className="row">
          <button className="btn primary" onClick={() => setView(true)}>Ver sesión</button>
          <button className="btn" onClick={() => setAdaptOpen((x) => !x)} aria-expanded={adaptOpen}>Adaptar</button>
          <button className="btn" onClick={() => setEdit(isPlanned ? (ses as PlannedSession) : { ...ses, status: "planificada" })}>
            <Icon name="move" />Mover en calendario
          </button>
          {!isPlanned && (
            <button className="btn" onClick={() => run((r) => r.savePlanned({ ...ses, status: "planificada" }), "Añadida al calendario de hoy")}>
              <Icon name="plus" />Añadir hoy
            </button>
          )}
        </div>
        {adaptOpen && (
          <div className="row" role="group" aria-label="Adaptar la sesión">
            <button className="chip" onClick={() => onAdapt({ minutes: 30 })}>Solo tengo 30 minutos</button>
            <button className="chip" onClick={() => onAdapt({ location: "casa" })}>Hacerla en casa</button>
            <button className="chip" onClick={() => onAdapt({ sleptBadly: true })}>He dormido poco</button>
            <button className="chip" onClick={() => onAdapt({ sport: "emtb" })}>Quiero salir con la e-MTB</button>
            <button className="chip" onClick={() => onAdapt({})}>Restablecer</button>
          </div>
        )}
      </div>
      {view && (
        <Modal title="Sesión de hoy" onClose={() => setView(false)}>
          <SessionDetails s={ses} />
        </Modal>
      )}
      {edit && <PlannedForm initial={edit} title={isPlanned ? "Mover o editar sesión" : "Revisar y añadir al calendario"} onClose={() => setEdit(null)} />}
    </Card>
  );
}

export default function Today() {
  const { data, today, tz, theme, mode } = useApp();
  const [filter, setFilter] = useState<Sport | "todos">("todos");
  const [overrides, setOverrides] = useState<Parameters<typeof suggestToday>[1]>({});
  const [pastingWod, setPastingWod] = useState(false);
  const [editGoals, setEditGoals] = useState(false);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const nav = useNavigate();

  const acts = useMemo(() => (filter === "todos" ? data.activities : data.activities.filter((a) => a.category === filter)), [data.activities, filter]);
  const suggestion = useMemo(() => suggestToday({ today, profile: data.profile, activities: data.activities, wellness: data.wellness,
    checkins: data.checkins, planned: data.planned }, overrides), [today, data, overrides]);

  const week = weekSummary(acts, data.planned, today);
  const prev4 = [1, 2, 3, 4].map((i) => summarize(inRange(acts, addDays(week.start, -7 * i), addDays(week.start, -7 * i + 6))).load);
  const prevLoads = prev4.filter(isNum);
  const avgLoad = prevLoads.length ? prevLoads.reduce((a, b) => a + b, 0) / prevLoads.length : null;
  const weights = realWeights(data.measurements);
  const lastW = weights[weights.length - 1];
  const doneToday = data.activities.filter((a) => a.local_date === today)
    .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
  const hrv = personalBaseline(data.wellness, "hrv", today);
  const plannedWeek = data.planned.filter((p) => p.date >= week.start && p.date <= addDays(week.start, 6) && p.category !== "descanso"
    && (p.status === "planificada" || p.status === "completada"));
  const recent = [...acts].sort((a, b) => b.local_date.localeCompare(a.local_date)).slice(0, 5);

  // Observaciones descriptivas (no causales)
  const notes: string[] = [];
  const hard = consecutiveHardDays(data.activities, today);
  if (hard >= 2) notes.push(`Llevas ${hard} días seguidos con sesiones de intensidad alta.`);
  if (hrv?.position === "por debajo") notes.push(`La HRV del ${fmtDay(hrv.date)} está por debajo de tu rango habitual de los últimos ${hrv.n} registros. Es un dato a vigilar, no un diagnóstico.`);
  if (lastW && diffDays(today, lastW.measured_on) > 14) notes.push(`Tu última medición de peso es del ${fmtDay(lastW.measured_on)}.`);
  if (!lastW) notes.push("Aún no hay ninguna medición de peso real registrada.");
  const review = data.activities.filter((a) => a.category_needs_review).length;
  if (review) notes.push(`${review} actividad(es) con tipo ambiguo pendientes de clasificar (por ejemplo, MTB o e-MTB).`);
  if (data.connection?.status === "parcial") notes.push("La última sincronización fue parcial: revisa Ajustes › Conexiones.");

  const p = data.profile;
  const setupPending: string[] = [];
  if (mode === "real") {
    if (!data.connection) setupPending.push("activar la sincronización con Intervals.icu");
    if (!p?.equipment?.length) setupPending.push("confirmar tu material");
    if (!p?.available_days?.length) setupPending.push("indicar tus días disponibles");
    if (!p?.goals) setupPending.push("escribir tus objetivos");
  }

  // Registro pendiente: solo lo explícitamente pendiente (bloques sin resultado o series por completar).
  // Una actividad sin series (bici, carrera…) no se considera incompleta.
  const pendingActs = data.activities
    .filter((a) => a.local_date >= addDays(today, -30))
    .map((a) => ({ a, p: activityPending(data, a.id) }))
    .filter((x) => hasPending(x.p))
    .sort((x, y) => y.a.local_date.localeCompare(x.a.local_date) || (y.a.start_time ?? "").localeCompare(x.a.start_time ?? ""));
  // Lo de hoy ya se ve en «Hecho hoy»: el aviso superior es para días anteriores
  const latestPending = pendingActs.find((x) => x.a.local_date !== today);
  const unlinked = unlinkedWorkouts(data);
  const firstName = p?.display_name?.trim().split(/\s+/)[0];
  const heroTitle = firstName ? `${greeting(tz)}, ${firstName}` : "Hoy";

  return (
    <>
      {latestPending && (
        <div className="card pad row between touch" style={{ marginBottom: 14 }}>
          <span className="stack" style={{ gap: 2 }}>
            <span className="pending-flag"><Icon name="alert" />Registro pendiente: {activityWodInfo(data, latestPending.a.id).title || latestPending.a.name || "actividad"} · {fmtDay(latestPending.a.local_date)}</span>
            <span className="small muted">{describePending(latestPending.p)}{pendingActs.filter((x) => x.a.local_date !== today).length > 1 ? ` · y ${pendingActs.filter((x) => x.a.local_date !== today).length - 1} actividad(es) más con datos pendientes` : ""}</span>
          </span>
          <Link className="btn sm primary" to={`/actividades/${latestPending.a.id}`}>Completar registro</Link>
        </div>
      )}
      {unlinked.length > 0 && (
        <div className="card pad row between touch" style={{ marginBottom: 14 }}>
          <span className="status info"><Icon name="info" />{unlinked.length === 1 ? `El WOD «${unlinked[0].title ?? "sin nombre"}» está` : `${unlinked.length} WOD están`} importado(s) sin actividad. Vincúlalo desde el detalle de la actividad cuando la tengas.</span>
          <Link className="btn sm" to="/actividades">Ir a Actividades</Link>
        </div>
      )}
      {setupPending.length > 0 && (
        <div className="card pad row between" style={{ marginBottom: 14 }}>
          <span className="status info"><Icon name="info" />Para completar la configuración falta {setupPending.join(", ")}.</span>
          <Link className="btn sm" to="/ajustes">Ir a Ajustes</Link>
        </div>
      )}
      <PageHead title={heroTitle} sub={<span className="row" style={{ gap: 12 }}><span>{fmtDayLong(today)}</span><SyncStatus /></span>}
        actions={
          <>
          <button className="btn primary" onClick={() => setPastingWod(true)}><Icon name="plus" />Pegar WOD</button>
          <div className="row" style={{ gap: 6 }} role="group" aria-label="Filtrar por deporte">
            <button className="chip" aria-pressed={filter === "todos"} onClick={() => setFilter("todos")}>Todos</button>
            {SPORTS.filter((s) => s !== "otro").map((s) => (
              <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
                <span className="dot" style={{ background: sportColor(s, theme) }} />{SPORT_SHORT[s]}
              </button>
            ))}
          </div>
          </>
        } />

      <div className="split">
        <div className="stack">
          {doneToday.length > 0 ? (
            <>
              <DoneToday acts={doneToday} onPasteWod={() => setPastingWod(true)} />
              {suggestion.session && (suggestion.kind === "planificada" || showSuggestion ? (
                <TodayHero s={suggestion} onAdapt={setOverrides} optional />
              ) : (
                <div className="card pad row between optional-sug">
                  <span className="small ink2">
                    Ya has entrenado hoy. Las reglas proponen además <b>{suggestion.session.title}</b>
                    {suggestion.session.duration_min ? ` · ${suggestion.session.duration_min} min` : ""}, sin tener en cuenta lo que ya has hecho.
                  </span>
                  <button className="btn ghost sm" onClick={() => setShowSuggestion(true)}>Ver sugerencia</button>
                </div>
              ))}
            </>
          ) : <TodayHero s={suggestion} onAdapt={setOverrides} />}

          <GoalsRow onEdit={() => setEditGoals(true)} />
          <WeightGoalCard />

          <div className="grid stats">
            <Stat label="Tiempo esta semana" icon="clock" tone="info" value={week.sessions ? fmtDuration(week.timeS, { short: true }) : null}
              foot={week.sessions ? `${week.sessions} sesiones` : "Sin actividades esta semana"} />
            <Stat label="Realizadas / planificadas" icon="check" tone="ok" value={plannedWeek.length ? `${week.sessions} / ${plannedWeek.length}` : week.sessions ? `${week.sessions}` : null}
              foot={plannedWeek.length ? `${week.plannedDone} del plan marcadas como completadas` : "Sin sesiones planificadas"} />
            <Stat label="Carga semanal" icon="bolt" tone="violet" value={week.load !== null ? fmtNum(week.load) : null}
              foot={avgLoad !== null ? `Media últimas 4 semanas: ${fmtNum(avgLoad)}` : "Sin histórico para comparar"} />
          </div>

          <Card title="Esta semana" icon="calendar" tone="violet" action={<Link to="/calendario" className="btn ghost sm">Calendario<Icon name="chevron" /></Link>}>
            <div className="weekstrip">
              {weekDays(today).map((d) => {
                const dayActs = acts.filter((a) => a.local_date === d);
                const dayPlan = data.planned.filter((p) => p.date === d && p.status !== "completada" && p.status !== "omitida");
                return (
                  <div key={d} className={`d ${d === today ? "today" : ""}`}>
                    <div className="lbl"><span>{dowShort(d)}</span><span className="num">{Number(d.slice(8))}</span></div>
                    {dayActs.map((a) => (
                      <Link key={a.id} to={`/actividades/${a.id}`} className="pill done" style={{ textDecoration: "none" }}>
                        <span className="bar" style={{ background: sportColor(a.category, theme) }} /><span className="t">{SPORT_SHORT[a.category]}</span>
                      </Link>
                    ))}
                    {dayPlan.map((p) => (
                      <span key={p.id} className={`pill ${p.status === "propuesta" ? "proposal" : "planned"}`}>
                        <span className="bar" style={{ background: sportColor(p.category, theme) }} />
                        <span className="t">{p.status === "propuesta" ? "Sug. " : ""}{SPORT_SHORT[p.category]}</span>
                      </span>
                    ))}
                    {!dayActs.length && !dayPlan.length && <span className="tiny muted">{d < today ? "Descanso" : "—"}</span>}
                  </div>
                );
              })}
            </div>
            <div className="cal-legend" style={{ marginTop: 10 }}>
              <span><span className="sw" style={{ background: "var(--surface-3)" }} />Realizada</span>
              <span><span className="sw" style={{ border: "1px solid var(--line-strong)" }} />Planificada</span>
              <span><span className="sw" style={{ border: "1px dashed var(--line-strong)" }} />Sugerencia</span>
            </div>
          </Card>
        </div>

        <div className="stack">
          <RecoveryCard />
          <CheckinCard />
          <Card title="Observaciones" icon="info" tone="info">
            {notes.length ? (
              <ul className="reasons">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
            ) : <p className="small muted">Nada destacable con los datos disponibles.</p>}
            <p className="tiny muted" style={{ marginTop: 8 }}>Son descripciones de tus datos, no conclusiones sobre sus causas.</p>
          </Card>
          <Card title="Actividades recientes" icon="list" tone="violet" action={<Link to="/actividades" className="btn ghost sm">Todas<Icon name="chevron" /></Link>}>
            {recent.length ? <div className="list" style={{ margin: "0 -16px -16px" }}>{recent.map((a) => { const w = activityWodInfo(data, a.id); const p = activityPending(data, a.id); return <ActivityRow key={a.id} a={a} wodTitle={w.title} tags={w.tags} pending={hasPending(p) ? describePending(p) : null} />; })}</div>
              : <Empty title="Sin actividades">Cuando se sincronicen o importes actividades aparecerán aquí.</Empty>}
          </Card>
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 16 }}>Zona horaria: {tz}.</p>
      {editGoals && <GoalsModal onClose={() => setEditGoals(false)} />}
      {pastingWod && <WodImportModal onClose={() => setPastingWod(false)} onSaved={(id) => { if (id) nav(`/actividades/${id}`); }} />}
    </>
  );
}
