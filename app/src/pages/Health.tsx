import { useMemo, useState } from "react";
import { LineChartBox, StackedBars, useChartTheme } from "../components/charts";
import { Icon } from "../components/icons";
import { PageHead } from "../components/Layout";
import { Card, Field, Modal, OriginBadge, Segmented, Stat } from "../components/ui";
import { useApp } from "../data/AppData";
import { addDays, fmtDay, fmtDayLong, rangeDays, startOfWeek } from "../lib/dates";
import { fmtDuration, fmtNum, fmtWeight, isNum, mean, stdev } from "../lib/format";
import { inRange, lastWith, personalBaseline, realWeights, rolling7, sleepStats, summarize, weightTrend } from "../lib/metrics";

function AddMeasurement({ onClose }: { onClose: () => void }) {
  const { run, today } = useApp();
  const [date, setDate] = useState(today);
  const [w, setW] = useState("");
  const [fat, setFat] = useState("");
  const [waist, setWaist] = useState("");
  const [notes, setNotes] = useState("");
  const save = async () => {
    const ok = await run((r) => r.addMeasurement({
      source: "manual", measured_on: date, weight_kg: w ? Number(w) : null, body_fat_pct: fat ? Number(fat) : null,
      waist_cm: waist ? Number(waist) : null, data_origin: "manual", notes: notes || null,
    }), "Medición registrada");
    if (ok !== undefined) onClose();
  };
  return (
    <Modal title="Registrar medición manual" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={!w && !waist} onClick={save}>Guardar</button></>}>
      <div className="form-grid">
        <Field label="Fecha"><input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Peso (kg)"><input className="input" type="number" step="0.1" min={20} max={300} value={w} onChange={(e) => setW(e.target.value)} /></Field>
        <Field label="Perímetro de cintura (cm)"><input className="input" type="number" step="0.5" min={40} max={200} value={waist} onChange={(e) => setWaist(e.target.value)} /></Field>
        <Field label="% grasa (opcional)" hint="Solo si lo mide un dispositivo; se mostrará como estimación"><input className="input" type="number" step="0.1" value={fat} onChange={(e) => setFat(e.target.value)} /></Field>
        <Field label="Notas" full><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export default function Health() {
  const { data, today, units, run } = useApp();
  const t = useChartTheme();
  const [adding, setAdding] = useState(false);
  const [span, setSpan] = useState<"30" | "90" | "365">("90");
  const from = addDays(today, -(Number(span) - 1));

  // ---- Peso: solo mediciones reales
  const weights = realWeights(data.measurements);
  const last = weights[weights.length - 1];
  const trend = weightTrend(data.measurements);
  const r7 = rolling7(data.measurements);
  const weightSeries = weights.filter((m) => m.measured_on >= from).map((m) => ({
    x: m.measured_on, peso: m.weight_kg, media7: r7.find((r) => r.date === m.measured_on)?.value ?? null,
  }));
  const has7 = weightSeries.some((p) => p.media7 !== null);
  const goal = data.profile?.weight_goal_kg ?? null;
  const fatRows = data.measurements.filter((m) => isNum(m.body_fat_pct)).sort((a, b) => a.measured_on.localeCompare(b.measured_on));
  const lastFat = fatRows[fatRows.length - 1];
  const waistRows = data.measurements.filter((m) => isNum(m.waist_cm)).sort((a, b) => a.measured_on.localeCompare(b.measured_on));

  // ---- Sueño
  const lastSleep = lastWith(data.wellness, "sleep_secs", today);
  const s7 = sleepStats(data.wellness, addDays(today, -6), today);
  const s30 = sleepStats(data.wellness, addDays(today, -29), today);
  const sleepSeries = rangeDays(from, today).map((d) => {
    const w = data.wellness.find((x) => x.date === d);
    return { x: d, horas: w && isNum(w.sleep_secs) ? Math.round((w.sleep_secs / 3600) * 10) / 10 : null };
  });
  const anyScore = data.wellness.some((w) => isNum(w.sleep_score));

  // ---- Recuperación
  const hrv = personalBaseline(data.wellness, "hrv", today);
  const rhr = personalBaseline(data.wellness, "resting_hr", today);
  const lastHrv = lastWith(data.wellness, "hrv", today);
  const lastRhr = lastWith(data.wellness, "resting_hr", today);
  const recSeries = useMemo(() => rangeDays(from, today).map((d) => {
    const w = data.wellness.find((x) => x.date === d);
    return { x: d, hrv: w?.hrv ?? null, rhr: w?.resting_hr ?? null };
  }), [data.wellness, from, today]);
  const hrvVals = recSeries.map((r) => r.hrv).filter(isNum);
  const hrvMean = mean(hrvVals);
  const hrvSd = stdev(hrvVals);
  const load7 = summarize(inRange(data.activities, addDays(today, -6), today)).load;
  const loads28 = [0, 1, 2, 3].map((i) => summarize(inRange(data.activities, addDays(today, -6 - 7 * i), addDays(today, -7 * i))).load ?? 0);
  const avgWeek28 = loads28.reduce((a, b) => a + b, 0) / 4;
  const checkins = [...data.checkins].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  // ---- Calorías de actividades por semana
  const kcalWeeks = Array.from({ length: 8 }, (_, i) => startOfWeek(addDays(today, -7 * (7 - i)))).map((ws) => {
    const s = summarize(inRange(data.activities, ws, addDays(ws, 6)));
    return { x: ws, kcal: s.calories ?? 0 };
  });

  return (
    <>
      <PageHead title="Salud y recuperación" sub="Peso, sueño y recuperación con tus propios datos como referencia"
        actions={<>
          <Segmented label="Periodo de gráficos" value={span} onChange={setSpan} options={[{ value: "30", label: "30 días" }, { value: "90", label: "90 días" }, { value: "365", label: "1 año" }]} />
          <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" />Registrar medición</button>
        </>} />

      <h2 style={{ margin: "4px 0 10px" }}>Peso y composición</h2>
      <div className="grid stats" style={{ marginBottom: 14 }}>
        <Stat label="Última medición" value={last ? fmtWeight(last.weight_kg, units) : null}
          badge={last ? <OriginBadge origin={last.data_origin === "manual" ? "manual" : "medido"} /> : undefined}
          foot={last ? `${fmtDayLong(last.measured_on)} · ${last.source === "intervals" ? "Feel Fit vía Intervals.icu" : "Registro manual"}` : "No hay mediciones reales"} />
        <Stat label="Tendencia" value={trend ? `${trend.deltaKg >= 0 ? "+" : "−"}${fmtNum(Math.abs(trend.deltaKg), 1)} kg` : null}
          foot={trend ? `Del ${fmtDay(trend.fromDate)} al ${fmtDay(trend.toDate)}` : `Se necesitan al menos 2 mediciones reales separadas 7–30 días (hay ${weights.length})`} />
        <Stat label="Objetivo" value={goal ? fmtWeight(goal, units) : null}
          foot={goal && last?.weight_kg ? `Diferencia: ${fmtNum(last.weight_kg - goal, 1)} kg` : "Opcional · configúralo en Ajustes"} />
        <Stat label="% grasa corporal" value={lastFat ? `${fmtNum(lastFat.body_fat_pct, 1)} %` : null}
          badge={lastFat ? <OriginBadge origin="estimado" title="Estimación por bioimpedancia de la báscula" /> : undefined}
          foot={lastFat ? `Estimación por bioimpedancia · ${fmtDay(lastFat.measured_on)}` : "No disponible"} />
      </div>
      <div className="split" style={{ marginBottom: 22 }}>
        <Card title="Historial de peso">
          {weightSeries.length >= 1 ? (
            <LineChartBox data={weightSeries} xKey="x" ariaLabel="Peso medido" xFormat={(v) => fmtDay(String(v))} yFormat={(v) => `${fmtNum(v, 1)}`}
              refLine={goal ? { y: goal, label: "Objetivo" } : undefined}
              series={[{ key: "peso", label: "Mediciones reales", color: t.ink }, ...(has7 ? [{ key: "media7", label: "Media de 7 días", color: t.info, dashed: true }] : [])]} />
          ) : <p className="small muted">No hay mediciones de peso en este periodo.</p>}
          <p className="chart-note">Solo se representan días con una medición real; no se arrastra el último peso a días sin pesaje. La media de 7 días aparece cuando hay al menos 3 mediciones en la ventana.</p>
        </Card>
        <Card title="Mediciones">
          {[...data.measurements].sort((a, b) => b.measured_on.localeCompare(a.measured_on)).slice(0, 12).map((m) => (
            <div key={m.id} className="row between" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="small">{fmtDay(m.measured_on)}</span>
              <span className="small num">{isNum(m.weight_kg) ? fmtWeight(m.weight_kg, units) : ""}{isNum(m.waist_cm) ? ` · cintura ${fmtNum(m.waist_cm, 1)} cm` : ""}</span>
              <span className="row nowrap" style={{ gap: 4 }}>
                <OriginBadge origin={m.data_origin === "manual" ? "manual" : "medido"} />
                {m.source === "manual" && <button className="btn ghost sm" aria-label="Eliminar medición" onClick={() => confirm("¿Eliminar esta medición?") && run((r) => r.deleteMeasurement(m.id), "Medición eliminada")}><Icon name="trash" /></button>}
              </span>
            </div>
          ))}
          {!data.measurements.length && <p className="small muted">Sin mediciones todavía.</p>}
          {waistRows.length > 0 && <p className="chart-note">Última cintura: {fmtNum(waistRows[waistRows.length - 1].waist_cm, 1)} cm ({fmtDay(waistRows[waistRows.length - 1].measured_on)}).</p>}
        </Card>
      </div>

      <h2 style={{ margin: "4px 0 10px" }}>Sueño</h2>
      <div className="grid stats" style={{ marginBottom: 14 }}>
        <Stat label="Última noche disponible" value={lastSleep ? fmtDuration(lastSleep.sleep_secs, { short: true }) : null}
          foot={lastSleep ? `Registrada el ${fmtDay(lastSleep.date)}` : "Sin datos de sueño"} />
        <Stat label="Media 7 días" value={s7.meanSecs ? fmtDuration(s7.meanSecs, { short: true }) : null} foot={`${s7.nights} noches con datos`} />
        <Stat label="Media 30 días" value={s30.meanSecs ? fmtDuration(s30.meanSecs, { short: true }) : null} foot={`${s30.nights} noches con datos`} />
        <Stat label="Regularidad (30 días)" value={s30.sdSecs ? `± ${fmtDuration(s30.sdSecs, { short: true })}` : null}
          foot="Variación de la duración entre noches" />
        {anyScore && <Stat label="Puntuación Garmin" value={lastSleep && isNum(lastSleep.sleep_score) ? fmtNum(lastSleep.sleep_score) : null}
          foot={s30.meanScore ? `Media 30 días: ${fmtNum(s30.meanScore)}` : undefined} />}
      </div>
      <Card title="Horas de sueño por noche" className="">
        {sleepSeries.some((s) => s.horas !== null)
          ? <StackedBars data={sleepSeries} xKey="x" ariaLabel="Horas de sueño" xFormat={(v) => fmtDay(String(v))} yFormat={(v) => `${fmtNum(v, 1)} h`}
            series={[{ key: "horas", label: "Horas", color: t.info }]} />
          : <p className="small muted">Sin datos de sueño en este periodo.</p>}
        <p className="chart-note">Horas de acostarse y despertar: sin datos (Intervals.icu no las ofrece por API para tu cuenta).</p>
      </Card>

      <h2 style={{ margin: "22px 0 10px" }}>Recuperación</h2>
      <div className="grid stats" style={{ marginBottom: 14 }}>
        <Stat label="HRV nocturna" value={lastHrv && isNum(lastHrv.hrv) ? fmtNum(lastHrv.hrv) : null} unit="ms"
          foot={hrv ? `Tu rango (30 días): ${fmtNum(hrv.mean - hrv.sd)}–${fmtNum(hrv.mean + hrv.sd)} ms · ${hrv.position}` : "Se necesitan al menos 7 registros previos para compararla con tu histórico"} />
        <Stat label="FC en reposo" value={lastRhr && isNum(lastRhr.resting_hr) ? fmtNum(lastRhr.resting_hr) : null} unit="ppm"
          foot={rhr ? `Tu rango (30 días): ${fmtNum(rhr.mean - rhr.sd)}–${fmtNum(rhr.mean + rhr.sd)} ppm · ${rhr.position}` : "Histórico insuficiente para comparar"} />
        <Stat label="Carga últimos 7 días" value={load7 !== null ? fmtNum(load7) : null} foot={`Media semanal de las últimas 4 semanas: ${fmtNum(avgWeek28)}`} />
      </div>
      <div className="split">
        <Card title="HRV y frecuencia cardiaca en reposo">
          {hrvVals.length >= 2 ? (
            <>
              <LineChartBox data={recSeries} xKey="x" ariaLabel="HRV" height={180} xFormat={(v) => fmtDay(String(v))}
                bands={hrvMean !== null && hrvSd !== null ? [{ y1: hrvMean - hrvSd, y2: hrvMean + hrvSd, color: t.info }] : undefined}
                series={[{ key: "hrv", label: "HRV (ms)", color: t.info }]} />
              <div style={{ marginTop: 8 }}>
                <LineChartBox data={recSeries} xKey="x" ariaLabel="FC en reposo" height={150} xFormat={(v) => fmtDay(String(v))}
                  series={[{ key: "rhr", label: "FC en reposo (ppm)", color: t.crit }]} />
              </div>
            </>
          ) : <p className="small muted">Datos insuficientes de HRV en este periodo.</p>}
          <p className="chart-note">La banda sombreada es tu propio rango (media ± 1 desviación típica del periodo). No se aplican umbrales universales ni se calcula una puntuación de recuperación: son datos para interpretar junto a cómo te encuentras.</p>
        </Card>
        <Card title="Sensaciones registradas">
          {checkins.length ? (
            <table className="data">
              <thead><tr><th>Día</th><th className="n">Energía</th><th className="n">Fatiga</th><th>Molestias</th></tr></thead>
              <tbody>{checkins.map((c) => (
                <tr key={c.date}><td>{fmtDay(c.date)}</td><td className="n">{c.energy ?? "–"}/5</td><td className="n">{c.fatigue ?? "–"}/5</td>
                  <td className="small">{c.soreness.length ? c.soreness.join(", ") : "—"}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="small muted">Aún no has registrado sensaciones. Hazlo desde «Hoy».</p>}
        </Card>
      </div>

      <h2 style={{ margin: "22px 0 10px" }}>Calorías</h2>
      <div className="split">
        <Card title="Calorías de actividades por semana" action={<OriginBadge origin="estimado" />}>
          {kcalWeeks.some((k) => k.kcal > 0)
            ? <StackedBars data={kcalWeeks} xKey="x" ariaLabel="Calorías de actividades" xFormat={(v) => fmtDay(String(v))} yFormat={(v) => `${fmtNum(v)} kcal`}
              series={[{ key: "kcal", label: "kcal de actividades", color: t.warn }]} />
            : <p className="small muted">Sin calorías registradas en actividades.</p>}
        </Card>
        <Card title="Gasto y balance">
          <div className="stack small ink2" style={{ gap: 8 }}>
            <p><b>Calorías de actividades:</b> estimación del dispositivo para cada sesión, sin sumar el gasto basal.</p>
            <p><b>Gasto total diario:</b> Sin datos. No está disponible en tu cuenta a través de la API; no se suma a las actividades para evitar duplicidades.</p>
            <p><b>Déficit o superávit:</b> no se calcula porque no hay ingesta registrada.</p>
          </div>
        </Card>
      </div>
      {adding && <AddMeasurement onClose={() => setAdding(false)} />}
    </>
  );
}
