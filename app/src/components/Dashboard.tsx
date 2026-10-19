// Panel «Hoy»: lo hecho hoy, objetivos (peso, calorías activas, sesiones, sueño)
// y recuperación. Solo datos reales; sin meta o sin dato se dice, no se inventa.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../data/AppData";
import { addDays, diffDays, fmtDay, fmtDayLong } from "../lib/dates";
import { fmtDuration, fmtNum, isNum } from "../lib/format";
import {
  activityKcal, sessionsGoal, sleepAverage, weekSessions, weightChart, weightPlan, type WeightPlan,
} from "../lib/goals";
import { durationOf, lastWith, personalBaseline } from "../lib/metrics";
import { activityPending, activityWodInfo, activeWorkoutsOf, describePending, hasPending } from "../lib/pending";
import { SPORT_LABEL, sportColor } from "../lib/sports";
import type { Activity, Profile } from "../lib/types";
import { LineChartBox, useChartTheme } from "./charts";
import { Icon } from "./icons";
import { Card, Field, Modal, SportChip } from "./ui";

// ---------------------------------------------------------------------------
// Anillo de progreso
// ---------------------------------------------------------------------------
export function Ring({ value, max, color, size = 76, children, label }: {
  value: number | null; max: number | null; color: string; size?: number; children?: ReactNode; label: string;
}) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const pct = isNum(value) && isNum(max) && max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={7} />
        {pct > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hecho hoy
// ---------------------------------------------------------------------------
export function DoneToday({ acts, onPasteWod }: { acts: Activity[]; onPasteWod: () => void }) {
  const { data, theme } = useApp();
  const totalS = acts.reduce((s, a) => s + (durationOf(a) ?? 0), 0);
  const k = activityKcal(acts, acts[0]?.local_date ?? "");
  return (
    <section className="card done-today" aria-label="Hecho hoy">
      <div className="done-head">
        <span className="eyebrow ok"><Icon name="check" />Hecho hoy</span>
        <span className="small muted">{acts.length > 1 ? `${acts.length} sesiones · ` : ""}{totalS ? fmtDuration(totalS, { short: true }) : ""}{k.kcal !== null ? ` · ${fmtNum(k.kcal)} kcal` : ""}</span>
      </div>
      {acts.map((a) => {
        const info = activityWodInfo(data, a.id);
        const p = activityPending(data, a.id);
        const hasWod = activeWorkoutsOf(data, a.id).length > 0;
        const wantsWod = !hasWod && a.category === "hiit";
        const dur = durationOf(a);
        return (
          <div key={a.id} className="done-item">
            <span className="hero-rail" style={{ background: sportColor(a.category, theme) }} />
            <div className="row between" style={{ gap: 8 }}>
              <SportChip cat={a.category} />
              {hasPending(p)
                ? <span className="pending-flag"><Icon name="alert" />Registro incompleto</span>
                : hasWod ? <span className="badge medido">Registro completo</span>
                : wantsWod ? <span className="badge muted-badge">Sin WOD</span> : null}
            </div>
            <div className="done-title">{info.title || a.name || SPORT_LABEL[a.category]}</div>
            <div className="done-metrics">
              <span><b className="num">{dur ? fmtDuration(dur, { short: true }) : "–"}</b><span className="muted"> duración</span></span>
              <span><b className="num">{isNum(a.calories) ? fmtNum(a.calories) : "–"}</b><span className="muted"> kcal</span></span>
              <span><b className="num">{isNum(a.avg_hr) ? fmtNum(a.avg_hr) : "–"}</b><span className="muted"> ppm media</span></span>
              {isNum(a.training_load) && <span><b className="num">{fmtNum(a.training_load)}</b><span className="muted"> carga</span></span>}
            </div>
            {hasPending(p) && <p className="small muted">{describePending(p)}</p>}
            <div className="row" style={{ gap: 8 }}>
              <Link className={`btn sm ${hasPending(p) ? "primary" : ""}`} to={`/actividades/${a.id}`}>
                {hasPending(p) ? "Completar registro" : "Ver sesión"}
              </Link>
              {wantsWod && <button className="btn sm" onClick={onPasteWod}><Icon name="plus" />Pegar WOD</button>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Objetivos: fila de indicadores
// ---------------------------------------------------------------------------
const GOAL_COLORS = { weight: "var(--emtb)", kcal: "var(--hiit)", sessions: "var(--ok)", sleep: "var(--run)" };

export function GoalsRow({ onEdit }: { onEdit: () => void }) {
  const { data, today } = useApp();
  const p = data.profile;
  const plan = weightPlan(p, data.measurements, today);
  const kToday = activityKcal(data.activities, today);
  const kGoal = p?.active_kcal_goal ?? null;
  const sess = weekSessions(data.activities, today);
  const sGoal = sessionsGoal(p);
  const sleep = sleepAverage(data.wellness, today);
  const sleepGoal = p?.sleep_goal_h ?? null;
  const noGoals = !isNum(p?.weight_goal_kg) && !isNum(kGoal) && !isNum(p?.sleep_goal_h) && !isNum(p?.sessions_week_goal);

  return (
    <Card title="Estado y objetivos" icon="target" tone="ok" action={<button className="btn ghost sm" onClick={onEdit}><Icon name="edit" />Mis objetivos</button>}>
      {noGoals && (
        <p className="small muted" style={{ marginBottom: 10 }}>
          Aún no has fijado objetivos. <button className="linkish" onClick={onEdit}>Fíjalos aquí</button> para ver tu progreso.
        </p>
      )}
      <div className="goals">
        <div className="goal">
          <Ring value={plan?.progress ?? null} max={1} color={GOAL_COLORS.weight} label="Progreso hacia el peso objetivo">
            <span className="num ring-val">{plan ? fmtNum(plan.current, 1) : "–"}</span><span className="ring-unit">kg</span>
          </Ring>
          <div className="goal-text">
            <span className="goal-label">Peso</span>
            {plan ? (
              <>
                <span className="goal-main">Objetivo {fmtNum(plan.goal, 1)} kg{plan.goalDate ? ` · ${fmtDay(plan.goalDate)}` : ""}</span>
                <span className="goal-foot">{Math.abs(plan.remaining) < 0.1 ? "Objetivo alcanzado" : `Faltan ${fmtNum(Math.abs(plan.remaining), 1)} kg`}{plan.actualKgWeek !== null ? ` · ritmo ${fmtSignedKg(plan.actualKgWeek)}/sem` : ""}</span>
              </>
            ) : (
              <span className="goal-foot">{isNum(p?.weight_goal_kg) ? "Sin mediciones reales de peso" : "Sin objetivo de peso"}</span>
            )}
          </div>
        </div>

        <div className="goal">
          <Ring value={kToday.kcal ?? 0} max={kGoal} color={GOAL_COLORS.kcal} label="Calorías activas de hoy frente a tu meta">
            <span className="num ring-val">{kToday.kcal !== null ? fmtNum(kToday.kcal) : "0"}</span><span className="ring-unit">kcal</span>
          </Ring>
          <div className="goal-text">
            <span className="goal-label">Calorías activas hoy</span>
            <span className="goal-main">{isNum(kGoal) ? `Meta ${fmtNum(kGoal)} kcal` : "Sin meta diaria"}</span>
            <span className="goal-foot">
              {isNum(kGoal) ? (kToday.kcal ?? 0) >= kGoal ? "Meta cumplida" : `Faltan ${fmtNum(kGoal - (kToday.kcal ?? 0))} kcal` : "Solo actividades registradas"}
              {kToday.missing ? ` · ${kToday.missing} sin dato` : ""}
            </span>
          </div>
        </div>

        <div className="goal">
          <Ring value={sess} max={sGoal.value} color={GOAL_COLORS.sessions} label="Sesiones de esta semana frente a tu meta">
            <span className="num ring-val">{sess}{isNum(sGoal.value) ? <span className="ring-unit">/{sGoal.value}</span> : null}</span>
          </Ring>
          <div className="goal-text">
            <span className="goal-label">Sesiones esta semana</span>
            <span className="goal-main">{isNum(sGoal.value) ? `Meta ${sGoal.value} / semana` : "Sin meta semanal"}</span>
            <span className="goal-foot">{sGoal.fromProfileDays ? "Según tus días disponibles" : isNum(sGoal.value) ? sess >= sGoal.value ? "Meta cumplida" : `Faltan ${sGoal.value - sess}` : "Lunes a domingo"}</span>
          </div>
        </div>

        <div className="goal">
          <Ring value={sleep.hours} max={sleepGoal} color={GOAL_COLORS.sleep} label="Sueño medio de 7 días frente a tu meta">
            <span className="num ring-val">{sleep.hours !== null ? fmtNum(sleep.hours, 1) : "–"}</span><span className="ring-unit">h</span>
          </Ring>
          <div className="goal-text">
            <span className="goal-label">Sueño (media 7 días)</span>
            <span className="goal-main">{isNum(sleepGoal) ? `Meta ${fmtNum(sleepGoal, 1)} h` : "Sin meta de sueño"}</span>
            <span className="goal-foot">{sleep.last ? `Anoche ${fmtDuration(sleep.last.sleep_secs, { short: true })}${sleep.n < 7 ? ` · ${sleep.n} noches con dato` : ""}` : "Sin datos de sueño recientes"}</span>
          </div>
        </div>
      </div>
      {plan?.dailyKcal != null && Math.abs(plan.remaining) >= 0.1 && (
        <p className="goal-note">
          <Icon name="info" />
          Para llegar a {fmtNum(plan.goal, 1)} kg el {fmtDayLong(plan.goalDate!)} ({plan.daysLeft} días) necesitas un {plan.dailyKcal > 0 ? "déficit" : "superávit"} medio de
          {" "}<b>~{fmtNum(Math.abs(Math.round(plan.dailyKcal / 10) * 10))} kcal/día</b> (dieta + actividad), unos {fmtNum(Math.abs(plan.neededKgWeek ?? 0), 2)} kg por semana.
          {plan.actualKgWeek !== null && <> Tu ritmo real de las últimas 4 semanas es {fmtSignedKg(plan.actualKgWeek)}/semana{plan.projectedDate ? `; a ese ritmo llegarías hacia el ${fmtDay(plan.projectedDate)}` : ""}.</>}
          <span className="muted"> Estimación orientativa (~7700 kcal por kg).</span>
        </p>
      )}
    </Card>
  );
}

function fmtSignedKg(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v), 2)} kg`;
}

// ---------------------------------------------------------------------------
// Evolución del peso con trayectoria al objetivo
// ---------------------------------------------------------------------------
export function WeightGoalCard() {
  const { data, today } = useApp();
  const t = useChartTheme();
  const plan = weightPlan(data.profile, data.measurements, today);
  const pts = weightChart(data.measurements, today, plan);
  const hasData = pts.some((p) => p.peso !== null);
  const hasPlan = pts.some((p) => p.plan !== null);
  return (
    <Card title="Evolución del peso" icon="chart" tone="info" action={<Link to="/salud" className="btn ghost sm">Salud<Icon name="chevron" /></Link>}>
      {hasData ? (
        <LineChartBox data={pts} xKey="x" height={200} ariaLabel="Peso semanal y trayectoria hasta el objetivo"
          xFormat={(v) => fmtDay(String(v))} yFormat={(v) => `${fmtNum(v, 1)} kg`}
          refLine={plan ? { y: plan.goal, label: `Objetivo ${fmtNum(plan.goal, 1)}` } : undefined}
          series={[
            { key: "peso", label: "Media semanal real", color: t.ink },
            ...(hasPlan ? [{ key: "plan", label: "Trayectoria al objetivo", color: "var(--emtb)", dashed: true }] : []),
          ]} />
      ) : <p className="small muted">Sin mediciones de peso en los últimos 90 días.</p>}
      {plan && !plan.goalDate && <p className="tiny muted" style={{ marginTop: 6 }}>Añade una fecha objetivo en «Mis objetivos» para ver la trayectoria y el déficit diario necesario.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recuperación
// ---------------------------------------------------------------------------
export function RecoveryCard() {
  const { data, today } = useApp();
  const hrv = personalBaseline(data.wellness, "hrv", today);
  const rhr = personalBaseline(data.wellness, "resting_hr", today);
  const lastHrv = lastWith(data.wellness, "hrv", today);
  const lastRhr = lastWith(data.wellness, "resting_hr", today);
  const fit = lastWith(data.wellness, "ctl", today);
  const tsb = fit && isNum(fit.ctl) && isNum(fit.atl) ? fit.ctl - fit.atl : null;
  const pos = (p: string | undefined) => (p === "dentro" ? "en tu rango" : p ? `${p} de tu rango` : "sin rango de referencia");
  const tone = (p: string | undefined, invert = false) => (p === "dentro" || !p ? "" : (p === "por debajo") !== invert ? "warn" : "ok");
  return (
    <Card title="Recuperación" icon="heart" tone="crit" action={<Link to="/salud" className="btn ghost sm">Detalle<Icon name="chevron" /></Link>}>
      <div className="recovery">
        <div className={`rec ${tone(hrv?.position)}`}>
          <span className="goal-label">HRV</span>
          <span className="rec-val num">{lastHrv && isNum(lastHrv.hrv) ? fmtNum(lastHrv.hrv) : "–"}<span className="ring-unit"> ms</span></span>
          <span className="goal-foot">{lastHrv ? `${pos(hrv?.position)}${diffDays(today, lastHrv.date) > 0 ? ` · ${fmtDay(lastHrv.date)}` : ""}` : "Sin datos"}</span>
        </div>
        <div className={`rec ${tone(rhr?.position, true)}`}>
          <span className="goal-label">FC en reposo</span>
          <span className="rec-val num">{lastRhr && isNum(lastRhr.resting_hr) ? fmtNum(lastRhr.resting_hr) : "–"}<span className="ring-unit"> ppm</span></span>
          <span className="goal-foot">{lastRhr ? pos(rhr?.position) : "Sin datos"}</span>
        </div>
        <div className="rec">
          <span className="goal-label">Forma (CTL − ATL)</span>
          <span className="rec-val num">{tsb !== null ? `${tsb > 0 ? "+" : ""}${fmtNum(tsb)}` : "–"}</span>
          <span className="goal-foot">{fit && isNum(fit.ctl) ? `Fitness ${fmtNum(fit.ctl)} · fatiga ${fmtNum(fit.atl)}` : "Sin datos de Intervals"}</span>
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 8 }}>Comparado con tus propios 30 días previos. Son datos a vigilar, no un diagnóstico.</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Mis objetivos
// ---------------------------------------------------------------------------
type GoalDraft = Pick<Profile, "weight_goal_kg"> & {
  weight_goal_date: string | null; active_kcal_goal: number | null; sessions_week_goal: number | null; sleep_goal_h: number | null;
};

export function GoalsModal({ onClose }: { onClose: () => void }) {
  const { data, today, run } = useApp();
  const p = data.profile;
  const [g, setG] = useState<GoalDraft>({
    weight_goal_kg: p?.weight_goal_kg ?? null,
    weight_goal_date: p?.weight_goal_date ?? null,
    active_kcal_goal: p?.active_kcal_goal ?? null,
    sessions_week_goal: p?.sessions_week_goal ?? null,
    sleep_goal_h: p?.sleep_goal_h ?? null,
  });
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  const preview: WeightPlan | null = weightPlan(p ? { ...p, ...g } : null, data.measurements, today);
  const invalid =
    (g.weight_goal_kg !== null && (g.weight_goal_kg < 30 || g.weight_goal_kg > 250)) ||
    (g.active_kcal_goal !== null && (g.active_kcal_goal < 50 || g.active_kcal_goal > 3000)) ||
    (g.sessions_week_goal !== null && (g.sessions_week_goal < 1 || g.sessions_week_goal > 14)) ||
    (g.sleep_goal_h !== null && (g.sleep_goal_h < 4 || g.sleep_goal_h > 12)) ||
    (g.weight_goal_date !== null && g.weight_goal_date <= today);
  const save = async () => {
    const done = await run((r) => r.saveProfile({
      ...g,
      active_kcal_goal: g.active_kcal_goal !== null ? Math.round(g.active_kcal_goal) : null,
      sessions_week_goal: g.sessions_week_goal !== null ? Math.round(g.sessions_week_goal) : null,
    }).then(() => true), "Objetivos guardados");
    if (done) onClose();
  };
  return (
    <Modal title="Mis objetivos" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={invalid} onClick={save}>Guardar</button></>}>
      <div className="form-grid">
        <Field label="Peso objetivo (kg)">
          <input className="input" aria-label="Peso objetivo (kg)" inputMode="decimal" value={g.weight_goal_kg ?? ""} placeholder="Ej.: 76"
            onChange={(e) => setG({ ...g, weight_goal_kg: num(e.target.value) })} />
        </Field>
        <Field label="Fecha objetivo" hint="Opcional. Sirve para calcular el ritmo y el déficit diario.">
          <input className="input" aria-label="Fecha objetivo" type="date" min={addDays(today, 1)} value={g.weight_goal_date ?? ""}
            onChange={(e) => setG({ ...g, weight_goal_date: e.target.value || null })} />
        </Field>
        <Field label="Calorías activas al día (kcal)" hint="Lo que quieres quemar entrenando cada día (kcal de actividades).">
          <input className="input" aria-label="Calorías activas al día (kcal)" inputMode="numeric" value={g.active_kcal_goal ?? ""} placeholder="Ej.: 600"
            onChange={(e) => setG({ ...g, active_kcal_goal: num(e.target.value) })} />
        </Field>
        <Field label="Sesiones por semana">
          <input className="input" aria-label="Sesiones por semana" inputMode="numeric" value={g.sessions_week_goal ?? ""} placeholder={`Ej.: ${p?.available_days?.length || 4}`}
            onChange={(e) => setG({ ...g, sessions_week_goal: num(e.target.value) })} />
        </Field>
        <Field label="Horas de sueño">
          <input className="input" aria-label="Horas de sueño" inputMode="decimal" value={g.sleep_goal_h ?? ""} placeholder="Ej.: 7,5"
            onChange={(e) => setG({ ...g, sleep_goal_h: num(e.target.value) })} />
        </Field>
      </div>
      {preview?.dailyKcal != null && (
        <p className="goal-note" style={{ marginTop: 12 }}>
          <Icon name="info" />De {fmtNum(preview.current, 1)} a {fmtNum(preview.goal, 1)} kg en {preview.daysLeft} días: ~{fmtNum(Math.abs(Math.round(preview.dailyKcal / 10) * 10))} kcal/día de {preview.dailyKcal > 0 ? "déficit" : "superávit"} ({fmtNum(Math.abs(preview.neededKgWeek ?? 0), 2)} kg/semana).
          {Math.abs(preview.neededKgWeek ?? 0) > 1 && <b> Es un ritmo muy exigente (más de 1 kg/semana).</b>}
        </p>
      )}
      {invalid && <p className="small" style={{ color: "var(--warn)", marginTop: 8 }}>Revisa los valores: peso 30–250 kg, calorías 50–3000, sesiones 1–14, sueño 4–12 h y una fecha futura.</p>}
      <p className="tiny muted" style={{ marginTop: 10 }}>Deja vacío lo que no quieras seguir. El peso objetivo es el mismo que en Ajustes.</p>
    </Modal>
  );
}
