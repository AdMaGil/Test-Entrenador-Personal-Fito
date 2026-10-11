import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IntensityMix } from "../components/charts";
import { Icon } from "../components/icons";
import { PageHead } from "../components/Layout";
import { PlannedForm, newDraft } from "../components/Sessions";
import { Card, Segmented } from "../components/ui";
import { useApp } from "../data/AppData";
import {
  addDays, addMonths, dowShort, fmtDay, fmtMonth, fmtWeekRange, monthWeeks, startOfMonth, startOfWeek, weekDays,
} from "../lib/dates";
import { fmtDistance, fmtDuration, fmtElevation, fmtNum, isNum } from "../lib/format";
import { durationOf, summarize, weekSummary } from "../lib/metrics";
import { isBike, SPORT_LABEL, SPORT_SHORT, SPORTS, sportColor } from "../lib/sports";
import type { Activity, PlannedDraft, PlannedSession, Sport, Wellness } from "../lib/types";

type View = "semana" | "mes" | "agenda";

function DayMetrics({ w, weight }: { w?: Wellness; weight?: number | null }) {
  const { units } = useApp();
  const items: [string, string][] = [];
  if (w && isNum(w.sleep_secs)) items.push(["Sueño", fmtDuration(w.sleep_secs, { short: true })]);
  if (w && isNum(w.hrv)) items.push(["HRV", `${fmtNum(w.hrv)} ms`]);
  if (w && isNum(w.resting_hr)) items.push(["FC reposo", `${fmtNum(w.resting_hr)}`]);
  if (isNum(weight)) items.push(["Peso", units.weight === "lb" ? `${fmtNum(weight * 2.20462, 1)} lb` : `${fmtNum(weight, 1)} kg`]);
  if (!items.length) return null;
  return (
    <div className="cal-day-metrics">
      {items.map(([k, v]) => <span key={k}>{k} <b>{v}</b></span>)}
    </div>
  );
}

function ActivityCardSmall({ a }: { a: Activity }) {
  const { theme, units } = useApp();
  const nav = useNavigate();
  const extra: string[] = [];
  if (isNum(a.avg_hr)) extra.push(`${Math.round(a.avg_hr)} ppm`);
  if (isNum(a.training_load)) extra.push(`carga ${fmtNum(a.training_load)}`);
  if (isBike(a.category) || a.category === "run") {
    if (isNum(a.distance_m)) extra.push(fmtDistance(a.distance_m, units));
    if (isNum(a.elevation_gain_m)) extra.push(`+${fmtElevation(a.elevation_gain_m, units)}`);
  }
  return (
    <button className="session-card done" onClick={() => nav(`/actividades/${a.id}`)}>
      <span className="rail" style={{ background: sportColor(a.category, theme) }} />
      <span className="kind"><Icon name="check" width={12} height={12} />Realizada · {SPORT_SHORT[a.category]}</span>
      <span className="title">{a.name || SPORT_LABEL[a.category]}</span>
      <span className="m">{fmtDuration(durationOf(a), { short: true })}{extra.length ? ` · ${extra.join(" · ")}` : ""}</span>
    </button>
  );
}

function PlannedCardSmall({ p, onOpen, matching }: { p: PlannedSession; onOpen: () => void; matching?: Activity }) {
  const { theme, run } = useApp();
  const proposal = p.status === "propuesta";
  return (
    <div className={`session-card ${proposal ? "proposal" : "planned"}`} role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}>
      <span className="rail" style={{ background: sportColor(p.category, theme), opacity: proposal ? 0.5 : 1 }} />
      <span className="kind"><Icon name={proposal ? "info" : "clock"} width={12} height={12} />
        {proposal ? "Sugerencia" : p.status === "completada" ? "Completada" : p.status === "omitida" ? "Omitida" : "Planificada"} · {SPORT_SHORT[p.category]}</span>
      <span className="title">{p.title}</span>
      <span className="m">{p.duration_min ? `${p.duration_min} min` : ""}{p.intensity ? ` · ${p.intensity}` : ""}{p.start_time ? ` · ${p.start_time.slice(0, 5)}` : ""}</span>
      {matching && p.status === "planificada" && (
        <button className="btn sm" style={{ marginTop: 4 }} onClick={(e) => {
          e.stopPropagation();
          void run((r) => r.savePlanned({ ...p, status: "completada", completed_activity_id: matching.id }), "Marcada como completada");
        }}>Marcar como completada</button>
      )}
    </div>
  );
}

function WeekSummaryCard({ start, acts }: { start: string; acts: Activity[] }) {
  const { data, theme, units } = useApp();
  const w = weekSummary(acts, data.planned, start);
  return (
    <Card title={`Resumen · ${fmtWeekRange(start)}`}>
      <div className="grid cols-4" style={{ gap: 10 }}>
        <div><div className="small muted">Tiempo</div><div className="num" style={{ fontSize: 20 }}>{w.sessions ? fmtDuration(w.timeS, { short: true }) : "Sin datos"}</div></div>
        <div><div className="small muted">Carga</div><div className="num" style={{ fontSize: 20 }}>{w.load !== null ? fmtNum(w.load) : "Sin datos"}</div></div>
        <div><div className="small muted">Calorías de actividades (estimación)</div><div className="num" style={{ fontSize: 20 }}>{w.calories !== null ? `${fmtNum(w.calories)} kcal` : "Sin datos"}</div></div>
        <div><div className="small muted">Cumplimiento del plan</div><div className="num" style={{ fontSize: 20 }}>{w.plannedTotal ? `${w.plannedDone}/${w.plannedTotal}` : "Sin plan"}</div></div>
      </div>
      <div className="divider" />
      <div className="row" style={{ gap: 8 }}>
        {SPORTS.filter((s) => w.bySport[s].sessions > 0).map((s) => (
          <span key={s} className="chip sport"><span className="dot" style={{ background: sportColor(s, theme) }} />
            {SPORT_SHORT[s]} · {w.bySport[s].sessions} · {fmtDuration(w.bySport[s].timeS, { short: true })}</span>
        ))}
        {!w.sessions && <span className="small muted">Sin actividades esta semana.</span>}
        {w.elevationM !== null && w.elevationM > 0 && <span className="chip">Desnivel {fmtElevation(w.elevationM, units)}</span>}
      </div>
      <div className="divider" />
      <div className="small muted" style={{ marginBottom: 6 }}>Distribución de intensidad (tiempo en zonas de FC)</div>
      <IntensityMix zones={w.zones} />
    </Card>
  );
}

export default function Calendar() {
  const { data, today, theme } = useApp();
  const [view, setView] = useState<View>(() => (window.innerWidth < 960 ? "agenda" : "semana"));
  const [anchor, setAnchor] = useState(today);
  const [filter, setFilter] = useState<Sport | "todos">("todos");
  const [edit, setEdit] = useState<{ draft: PlannedDraft; title: string } | null>(null);

  const acts = useMemo(() => (filter === "todos" ? data.activities : data.activities.filter((a) => a.category === filter)), [data.activities, filter]);
  const planned = useMemo(() => (filter === "todos" ? data.planned : data.planned.filter((p) => p.category === filter)), [data.planned, filter]);
  const wellByDate = useMemo(() => new Map(data.wellness.map((w) => [w.date, w])), [data.wellness]);
  const weightByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of data.measurements) if (isNum(x.weight_kg)) m.set(x.measured_on, x.weight_kg);
    return m;
  }, [data.measurements]);

  const step = (n: number) => setAnchor(view === "mes" ? addMonths(anchor, n) : addDays(anchor, 7 * n));
  const title = view === "mes" ? fmtMonth(startOfMonth(anchor)) : fmtWeekRange(startOfWeek(anchor));
  const days = weekDays(anchor);

  const openPlanned = (p: PlannedSession) => setEdit({ draft: p, title: p.status === "propuesta" ? "Revisar sugerencia" : "Editar o mover sesión" });
  const addOn = (d: string) => setEdit({ draft: newDraft(d, filter === "todos" ? "hiit" : filter), title: "Añadir sesión planificada" });
  const matchFor = (p: PlannedSession) => p.date <= today ? acts.find((a) => a.local_date === p.date && a.category === p.category) : undefined;

  const dayContent = (d: string) => {
    const dActs = acts.filter((a) => a.local_date === d);
    const dPlan = planned.filter((p) => p.date === d);
    return (
      <>
        {dActs.map((a) => <ActivityCardSmall key={a.id} a={a} />)}
        {dPlan.map((p) => <PlannedCardSmall key={p.id} p={p} onOpen={() => openPlanned(p)} matching={matchFor(p)} />)}
        {!dActs.length && !dPlan.length && <span className="rest">{d < today ? "Descanso" : "Sin sesiones"}</span>}
      </>
    );
  };

  return (
    <>
      <PageHead title="Calendario" sub="Semanas de lunes a domingo"
        actions={<>
          <Segmented label="Vista" value={view} onChange={setView}
            options={[{ value: "semana", label: "Semana" }, { value: "mes", label: "Mes" }, { value: "agenda", label: "Agenda" }]} />
          <button className="btn primary" onClick={() => addOn(today < days[0] || today > days[6] ? days[0] : today)}><Icon name="plus" />Añadir sesión</button>
        </>} />

      <div className="row between" style={{ marginBottom: 12 }}>
        <div className="row nowrap">
          <button className="btn sm" onClick={() => step(-1)} aria-label="Anterior"><Icon name="back" /></button>
          <button className="btn sm" onClick={() => setAnchor(today)}>Hoy</button>
          <button className="btn sm" onClick={() => step(1)} aria-label="Siguiente"><Icon name="chevron" /></button>
          <h2 style={{ marginLeft: 6, textTransform: "capitalize" }}>{title}</h2>
        </div>
        <div className="row" style={{ gap: 6 }} role="group" aria-label="Filtrar por deporte">
          <button className="chip" aria-pressed={filter === "todos"} onClick={() => setFilter("todos")}>Todos</button>
          {SPORTS.map((s) => (
            <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
              <span className="dot" style={{ background: sportColor(s, theme) }} />{SPORT_SHORT[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="cal-legend" style={{ marginBottom: 12 }}>
        <span><span className="sw" style={{ background: "var(--surface-3)" }} />Realizada (dato medido)</span>
        <span><span className="sw" style={{ border: "1px solid var(--line-strong)" }} />Planificada por ti</span>
        <span><span className="sw" style={{ border: "1px dashed var(--line-strong)" }} />Sugerencia pendiente de revisar</span>
      </div>

      {view === "semana" && (
        <div className="stack">
          <div style={{ overflowX: "auto" }}>
            <div className="cal-week" style={{ minWidth: 880 }}>
              {days.map((d) => (
                <div key={d} className={`cal-day ${d === today ? "today" : ""} ${d < today ? "past" : ""}`}>
                  <div className="cal-day-head">
                    <span className="small muted" style={{ textTransform: "capitalize" }}>{dowShort(d)}</span>
                    <span className="row nowrap" style={{ gap: 4 }}>
                      <span className="n">{Number(d.slice(8))}</span>
                      <button className="btn ghost sm" style={{ minHeight: 24, padding: "2px 4px" }} onClick={() => addOn(d)} aria-label={`Añadir sesión el ${fmtDay(d)}`}><Icon name="plus" width={14} height={14} /></button>
                    </span>
                  </div>
                  <DayMetrics w={wellByDate.get(d)} weight={weightByDate.get(d)} />
                  <div className="cal-day-body">{dayContent(d)}</div>
                </div>
              ))}
            </div>
          </div>
          <WeekSummaryCard start={days[0]} acts={acts} />
        </div>
      )}

      {view === "agenda" && (
        <div className="stack">
          <section className="card agenda-week">
            {days.map((d) => (
              <div key={d} className={`agenda-day ${d === today ? "today" : ""}`}>
                <div className="dl">
                  <div className="dw">{dowShort(d)}</div>
                  <div className="dn">{Number(d.slice(8))}</div>
                  <button className="btn ghost sm" style={{ padding: "2px 4px", minHeight: 24, marginTop: 4 }} onClick={() => addOn(d)} aria-label={`Añadir sesión el ${fmtDay(d)}`}><Icon name="plus" width={14} height={14} /></button>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  <DayMetrics w={wellByDate.get(d)} weight={weightByDate.get(d)} />
                  {dayContent(d)}
                </div>
              </div>
            ))}
          </section>
          <WeekSummaryCard start={days[0]} acts={acts} />
        </div>
      )}

      {view === "mes" && (
        <div className="cal-month">
          {["lun", "mar", "mié", "jue", "vie", "sáb", "dom"].map((h) => <div key={h} className="h">{h}</div>)}
          <div className="h wkh">Semana</div>
          {monthWeeks(anchor).map((wk) => {
            const s = summarize(acts.filter((a) => a.local_date >= wk[0] && a.local_date <= wk[6]));
            return [
              ...wk.map((d) => {
                const dActs = acts.filter((a) => a.local_date === d);
                const dPlan = planned.filter((p) => p.date === d && p.status !== "completada");
                const out = d.slice(0, 7) !== startOfMonth(anchor).slice(0, 7);
                return (
                  <div key={d} className={`cell ${out ? "out" : ""} ${d === today ? "today" : ""}`}>
                    <span className="tiny muted num">{Number(d.slice(8))}</span>
                    {dActs.map((a) => (
                      <button key={a.id} className="pill done" style={{ border: 0, cursor: "pointer", textAlign: "left" }} onClick={() => setAnchor(d)}
                        title={`${SPORT_LABEL[a.category]} · ${fmtDuration(durationOf(a), { short: true })}`}>
                        <span className="bar" style={{ background: sportColor(a.category, theme) }} />
                        <span className="t">{SPORT_SHORT[a.category]} {fmtDuration(durationOf(a), { short: true })}</span>
                      </button>
                    ))}
                    {dPlan.map((p) => (
                      <button key={p.id} className={`pill ${p.status === "propuesta" ? "proposal" : "planned"}`} style={{ background: "none", cursor: "pointer", textAlign: "left" }}
                        onClick={() => openPlanned(p)} title={p.title}>
                        <span className="bar" style={{ background: sportColor(p.category, theme) }} />
                        <span className="t">{p.status === "propuesta" ? "Sug. " : ""}{SPORT_SHORT[p.category]}</span>
                      </button>
                    ))}
                  </div>
                );
              }),
              <div key={`${wk[0]}-sum`} className="wk">
                <span className="num">{s.sessions ? fmtDuration(s.timeS, { short: true }) : "—"}</span>
                <span>{s.sessions} sesiones</span>
                <span>{s.load !== null ? `Carga ${fmtNum(s.load)}` : "Carga: sin datos"}</span>
              </div>,
            ];
          })}
        </div>
      )}

      {edit && <PlannedForm initial={edit.draft} title={edit.title} onClose={() => setEdit(null)} />}
    </>
  );
}
