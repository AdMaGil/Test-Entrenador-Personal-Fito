import { useMemo, useState } from "react";
import { IntensityMix, LineChartBox, StackedBars, ZoneBars, useChartTheme } from "../components/charts";
import { PageHead } from "../components/Layout";
import { Card, Field, OriginBadge, Segmented, Stat } from "../components/ui";
import { useApp } from "../data/AppData";
import { addDays, diffDays, fmtDay, rangeDays, startOfWeek } from "../lib/dates";
import { fmtDuration, fmtNum, fmtSigned, isNum, pctChange } from "../lib/format";
import { durationOf, fitnessSeries, inRange, previousPeriod, summarize, type Period } from "../lib/metrics";
import { isBike, SPORT_LABEL, SPORT_SHORT, SPORTS, sportColor } from "../lib/sports";
import type { Activity, Sport } from "../lib/types";

type Range = "7" | "28" | "90" | "365" | "custom";

function Delta({ curr, prev, unit = "%" }: { curr: number | null; prev: number | null; unit?: string }) {
  if (!isNum(curr) || !isNum(prev)) return <>Sin periodo anterior para comparar</>;
  const ch = pctChange(curr, prev);
  if (ch === null) return <>Periodo anterior sin datos</>;
  return <>{fmtSigned(ch, 0, ` ${unit}`)} frente al periodo anterior</>;
}

const METRICS: Record<string, { label: string; get: (a: Activity, rpe?: number | null) => number | null; sports?: Sport[]; fmt: (v: number) => string }> = {
  avg_hr: { label: "FC media (ppm)", get: (a) => a.avg_hr, fmt: (v) => `${fmtNum(v)} ppm` },
  load: { label: "Carga", get: (a) => a.training_load, fmt: (v) => fmtNum(v) },
  duration: { label: "Duración (min)", get: (a) => { const d = durationOf(a); return d ? d / 60 : null; }, fmt: (v) => `${fmtNum(v)} min` },
  low: { label: "% tiempo en Z1–Z2", get: (a) => {
    const z = a.hr_zone_times_s; const t = z?.reduce((x, y) => x + y, 0) ?? 0;
    return z && t ? ((z[0] + (z[1] ?? 0)) / t) * 100 : null;
  }, fmt: (v) => `${fmtNum(v)} %` },
  rpe: { label: "Esfuerzo percibido (RPE)", get: (_a, rpe) => rpe ?? null, fmt: (v) => fmtNum(v) },
  hr_per_kmh: { label: "FC media por km/h (solo MTB)", sports: ["mtb"], get: (a) => (a.avg_hr && a.avg_speed_ms ? a.avg_hr / (a.avg_speed_ms * 3.6) : null), fmt: (v) => fmtNum(v, 1) },
};

export default function Evolution() {
  const { data, today, theme } = useApp();
  const t = useChartTheme();
  const [range, setRange] = useState<Range>("28");
  const [cFrom, setCFrom] = useState(addDays(today, -60));
  const [cTo, setCTo] = useState(today);
  const [sport, setSport] = useState<Sport>("hiit");
  const [metric, setMetric] = useState("avg_hr");

  const period: Period = range === "custom" ? { from: cFrom, to: cTo } : { from: addDays(today, -(Number(range) - 1)), to: today };
  const prevP = previousPeriod(period);
  const days = diffDays(period.to, period.from) + 1;
  const curr = useMemo(() => summarize(inRange(data.activities, period.from, period.to)), [data.activities, period.from, period.to]);
  const prev = useMemo(() => summarize(inRange(data.activities, prevP.from, prevP.to)), [data.activities, prevP.from, prevP.to]);
  const weeks = days / 7;

  // Carga por semana (o por día en periodos cortos), apilada por deporte
  const byWeek = days > 14;
  const loadData = useMemo(() => {
    const buckets = byWeek
      ? (() => { const out: string[] = []; for (let d = startOfWeek(period.from); d <= period.to; d = addDays(d, 7)) out.push(d); return out; })()
      : rangeDays(period.from, period.to);
    return buckets.map((b) => {
      const end = byWeek ? addDays(b, 6) : b;
      const acts = inRange(data.activities, b, end);
      const row: Record<string, number | string> = { x: b };
      for (const s of SPORTS) row[s] = acts.filter((a) => a.category === s).reduce((acc, a) => acc + (a.training_load ?? 0), 0);
      return row;
    });
  }, [data.activities, period.from, period.to, byWeek]);
  const sportsPresent = SPORTS.filter((s) => loadData.some((r) => (r[s] as number) > 0));

  const fit = useMemo(() => fitnessSeries(data.wellness, period.from, period.to), [data.wellness, period.from, period.to]);
  const hasFit = fit.some((p) => p.ctl !== null);
  const lastFit = [...fit].reverse().find((p) => p.ctl !== null);

  const periodActs = inRange(data.activities, period.from, period.to);
  const metricDef = METRICS[metric];
  const comparable = data.activities.filter((a) => a.category === sport && a.local_date >= period.from && a.local_date <= period.to)
    .sort((a, b) => a.local_date.localeCompare(b.local_date))
    .map((a) => ({ x: a.local_date, v: metricDef.get(a, data.feedback[a.id]?.rpe) }));

  return (
    <>
      <PageHead title="Evolución" sub={`${fmtDay(period.from)} – ${fmtDay(period.to)} · comparado con ${fmtDay(prevP.from)} – ${fmtDay(prevP.to)}`}
        actions={<Segmented label="Periodo" value={range} onChange={setRange} options={[
          { value: "7", label: "7 días" }, { value: "28", label: "28 días" }, { value: "90", label: "90 días" },
          { value: "365", label: "1 año" }, { value: "custom", label: "Personalizado" }]} />} />
      {range === "custom" && (
        <div className="row" style={{ marginBottom: 14 }}>
          <Field label="Desde"><input className="input" type="date" value={cFrom} max={cTo} onChange={(e) => setCFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={cTo} min={cFrom} max={today} onChange={(e) => setCTo(e.target.value)} /></Field>
        </div>
      )}

      <div className="grid stats" style={{ marginBottom: 14 }}>
        <Stat label="Tiempo total" value={curr.sessions ? fmtDuration(curr.timeS, { short: true }) : null} foot={<Delta curr={curr.timeS} prev={prev.sessions ? prev.timeS : null} />} />
        <Stat label="Sesiones" value={curr.sessions || null} foot={<Delta curr={curr.sessions} prev={prev.sessions || null} />} />
        <Stat label="Frecuencia" value={curr.sessions ? fmtNum(curr.sessions / weeks, 1) : null} unit="/semana" foot={`${fmtNum(prev.sessions / weeks, 1)} /semana en el periodo anterior`} />
        <Stat label="Carga total" value={curr.load !== null ? fmtNum(curr.load) : null} foot={<Delta curr={curr.load} prev={prev.load} />} />
      </div>

      <div className="split">
        <div className="stack">
          <Card title={byWeek ? "Carga por semana y deporte" : "Carga por día y deporte"}>
            {sportsPresent.length ? (
              <StackedBars data={loadData} xKey="x" ariaLabel="Carga por deporte" xFormat={(v) => fmtDay(String(v))}
                series={sportsPresent.map((s) => ({ key: s, label: SPORT_SHORT[s], color: sportColor(s, theme) }))} />
            ) : <p className="small muted">Sin carga registrada en este periodo.</p>}
          </Card>

          <Card title="Aptitud, fatiga y forma" action={<OriginBadge origin="estimado" title="Calculado por Intervals.icu a partir de tu carga registrada" />}>
            {hasFit ? (
              <>
                <LineChartBox data={fit} xKey="date" ariaLabel="Aptitud y fatiga" xFormat={(v) => fmtDay(String(v))}
                  series={[{ key: "ctl", label: "Aptitud (42 días)", color: t.info }, { key: "atl", label: "Fatiga (7 días)", color: t.crit }]} />
                <div style={{ marginTop: 10 }}>
                  <LineChartBox data={fit} xKey="date" height={150} ariaLabel="Forma" xFormat={(v) => fmtDay(String(v))} refLine={{ y: 0 }}
                    series={[{ key: "tsb", label: "Forma (aptitud − fatiga)", color: t.ink2 }]} />
                </div>
                <div className="stack small ink2" style={{ gap: 6, marginTop: 10 }}>
                  {lastFit && <p>Último valor ({fmtDay(lastFit.date)}): aptitud <b className="num">{fmtNum(lastFit.ctl)}</b>, fatiga <b className="num">{fmtNum(lastFit.atl)}</b>, forma <b className="num">{fmtSigned(lastFit.tsb)}</b>.</p>}
                  <p><b>Aptitud</b> es la media ponderada de tu carga de los últimos 42 días; sube despacio cuando entrenas con constancia. <b>Fatiga</b> es lo mismo con 7 días: reacciona rápido a las semanas duras. <b>Forma</b> es la diferencia: negativa cuando acumulas carga reciente, positiva cuando descansas.</p>
                  <p className="muted">Son estimaciones de Intervals.icu basadas solo en la carga registrada. No miden tu recuperación completa ni sustituyen cómo te encuentras.</p>
                </div>
              </>
            ) : <p className="small muted">Sin datos de aptitud y fatiga en este periodo.</p>}
          </Card>

          <Card title="Evolución de sesiones comparables">
            <div className="row" style={{ marginBottom: 10 }}>
              <select className="input" style={{ width: "auto" }} value={sport} onChange={(e) => setSport(e.target.value as Sport)} aria-label="Deporte">
                {SPORTS.filter((s) => s !== "otro").map((s) => <option key={s} value={s}>{SPORT_LABEL[s]}</option>)}
              </select>
              <select className="input" style={{ width: "auto" }} value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Métrica">
                {Object.entries(METRICS).filter(([, m]) => !m.sports || m.sports.includes(sport)).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </div>
            {comparable.filter((c) => isNum(c.v)).length >= 2 ? (
              <LineChartBox data={comparable} xKey="x" ariaLabel={`${metricDef.label} en sesiones de ${SPORT_LABEL[sport]}`}
                xFormat={(v) => fmtDay(String(v))} yFormat={(v) => metricDef.fmt(v)}
                series={[{ key: "v", label: metricDef.label, color: sportColor(sport, theme) }]} />
            ) : <p className="small muted">Hacen falta al menos dos sesiones de {SPORT_LABEL[sport]} con este dato en el periodo.</p>}
            {sport === "emtb" && <p className="chart-note">En e-MTB no se compara la velocidad ni la distancia como medida de forma: dependen de la asistencia del motor.</p>}
          </Card>
        </div>

        <div className="stack">
          <Card title="Por deporte">
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Deporte</th><th className="n">Sesiones</th><th className="n">/semana</th><th className="n">Tiempo</th><th className="n">Antes</th></tr></thead>
                <tbody>
                  {SPORTS.filter((s) => curr.bySport[s].sessions || prev.bySport[s].sessions).map((s) => (
                    <tr key={s}>
                      <td><span className="chip sport"><span className="dot" style={{ background: sportColor(s, theme) }} />{SPORT_SHORT[s]}</span></td>
                      <td className="n">{curr.bySport[s].sessions}</td>
                      <td className="n">{fmtNum(curr.bySport[s].sessions / weeks, 1)}</td>
                      <td className="n">{fmtDuration(curr.bySport[s].timeS, { short: true })}</td>
                      <td className="n muted">{prev.bySport[s].sessions} · {fmtDuration(prev.bySport[s].timeS, { short: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="chart-note">No se comparan deportes distintos por kilómetros o velocidad.</p>
          </Card>
          <Card title="Distribución de intensidad">
            <IntensityMix zones={curr.zones} />
          </Card>
          <Card title="Tiempo en zonas (todo el periodo)">
            <ZoneBars times={curr.zones} />
          </Card>
          {periodActs.some((a) => isBike(a.category)) && (
            <Card title="Ciclismo">
              <p className="small ink2">Desnivel acumulado (MTB + e-MTB): <b className="num">{fmtNum(periodActs.filter((a) => isBike(a.category)).reduce((s, a) => s + (a.elevation_gain_m ?? 0), 0))} m</b></p>
              <p className="chart-note">MTB y e-MTB se analizan por separado; en e-MTB el desnivel lo comparte el motor.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
