import { useMemo } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { useApp } from "../data/AppData";
import { fmtClock, fmtDuration, fmtNum } from "../lib/format";
import { intensityMix } from "../lib/metrics";

export function useChartTheme() {
  const { theme } = useApp();
  return useMemo(() => {
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim();
    return {
      grid: v("--line"), axis: v("--ink-3"), ink: v("--ink"), ink2: v("--ink-2"), surface: v("--surface"),
      surface2: v("--surface-2"), line: v("--line-strong"), ok: v("--ok"), warn: v("--warn"), crit: v("--crit"), info: v("--info"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}

export interface Series {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
}

function TooltipBox({ active, payload, label, xFormat, yFormat }: {
  active?: boolean; payload?: { name: string; value: number | null; color: string; dataKey: string }[]; label?: string | number;
  xFormat?: (v: string | number) => string; yFormat?: (v: number, key: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5 }}>
      <div style={{ color: "var(--ink-3)", marginBottom: 4 }}>{xFormat ? xFormat(label as string) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--ink-2)" }}>
            <span style={{ width: 10, height: 3, borderRadius: 2, background: p.color }} />{p.name}
          </span>
          <span className="num" style={{ color: "var(--ink)" }}>
            {p.value === null || p.value === undefined ? "Sin datos" : yFormat ? yFormat(p.value, p.dataKey) : fmtNum(p.value, 1)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="row" style={{ gap: 14, marginBottom: 6 }}>
      {series.map((s) => (
        <span key={s.key} className="small ink2" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 3, borderRadius: 2, background: s.color, borderTop: s.dashed ? `1px dashed ${s.color}` : undefined }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function LineChartBox<T extends object>({
  data, xKey, series, height = 220, xFormat, yFormat, yDomain, refLine, bands, ariaLabel,
}: {
  data: T[]; xKey: keyof T & string; series: Series[]; height?: number;
  xFormat?: (v: string | number) => string; yFormat?: (v: number, key: string) => string;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  refLine?: { y: number; label?: string }; bands?: { y1: number; y2: number; color: string; label?: string }[]; ariaLabel: string;
}) {
  const t = useChartTheme();
  return (
    <div className="chart-wrap" role="img" aria-label={ariaLabel}>
      <Legend series={series} />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={t.grid} vertical={false} />
          {bands?.map((b) => <ReferenceArea key={b.y1} y1={b.y1} y2={b.y2} fill={b.color} fillOpacity={0.08} ifOverflow="extendDomain" />)}
          <XAxis dataKey={xKey} tick={{ fill: t.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.grid }}
            tickFormatter={xFormat} minTickGap={28} />
          <YAxis tick={{ fill: t.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={44} domain={yDomain ?? ["auto", "auto"]}
            tickFormatter={(v: number) => fmtNum(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0)} />
          {refLine && <ReferenceLine y={refLine.y} stroke={t.line} strokeDasharray="4 4" label={refLine.label ? { value: refLine.label, fill: t.axis, fontSize: 11, position: "insideTopLeft" } : undefined} />}
          <Tooltip cursor={{ stroke: t.line, strokeWidth: 1 }} content={<TooltipBox xFormat={xFormat} yFormat={yFormat} />} />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined} dot={data.length <= 24 ? { r: 3, strokeWidth: 0, fill: s.color } : false}
              activeDot={{ r: 5, stroke: t.surface, strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StackedBars<T extends object>({
  data, xKey, series, height = 220, xFormat, yFormat, ariaLabel,
}: {
  data: T[]; xKey: keyof T & string; series: Series[]; height?: number;
  xFormat?: (v: string | number) => string; yFormat?: (v: number, key: string) => string; ariaLabel: string;
}) {
  const t = useChartTheme();
  return (
    <div className="chart-wrap" role="img" aria-label={ariaLabel}>
      <Legend series={series} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }} barCategoryGap="22%">
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: t.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: t.grid }} tickFormatter={xFormat} minTickGap={16} />
          <YAxis tick={{ fill: t.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={44}
            tickFormatter={(v: number) => fmtNum(v, Math.abs(v) < 10 && !Number.isInteger(v) ? 1 : 0)} />
          <Tooltip cursor={{ fill: t.surface2 }} content={<TooltipBox xFormat={xFormat} yFormat={yFormat} />} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} stroke={t.surface} strokeWidth={2}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HrChart({ time, hr, bounds, height = 200 }: { time: number[]; hr: number[]; bounds: number[] | null; height?: number }) {
  const t = useChartTheme();
  const data = useMemo(() => time.map((s, i) => ({ t: s, hr: hr[i] ?? null })), [time, hr]);
  return (
    <div className="chart-wrap" role="img" aria-label="Frecuencia cardiaca a lo largo de la sesión">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: t.axis, fontSize: 11 }} tickLine={false}
            axisLine={{ stroke: t.grid }} tickFormatter={(v: number) => fmtClock(v)} minTickGap={40} />
          <YAxis tick={{ fill: t.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={40} domain={["dataMin - 5", "dataMax + 5"]} />
          {bounds?.slice(0, 6).map((b, i) => (
            <ReferenceLine key={b} y={b} stroke={t.grid} strokeDasharray="2 4"
              label={{ value: `Z${i + 2}`, fill: t.axis, fontSize: 10, position: "insideRight" }} />
          ))}
          <Tooltip cursor={{ stroke: t.line }} content={<TooltipBox xFormat={(v) => fmtClock(Number(v))} yFormat={(v) => `${Math.round(v)} ppm`} />} />
          <Line type="monotone" dataKey="hr" name="FC" stroke={t.crit} strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ElevationChart({ distance, altitude, color, height = 160 }: { distance: number[]; altitude: number[]; color: string; height?: number }) {
  const t = useChartTheme();
  const data = useMemo(() => altitude.map((a, i) => ({ d: (distance[i] ?? 0) / 1000, alt: a })), [distance, altitude]);
  return (
    <div className="chart-wrap" role="img" aria-label="Perfil de elevación">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={t.grid} vertical={false} />
          <XAxis dataKey="d" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: t.axis, fontSize: 11 }} tickLine={false}
            axisLine={{ stroke: t.grid }} tickFormatter={(v: number) => `${fmtNum(v, 0)} km`} minTickGap={40} />
          <YAxis tick={{ fill: t.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={44} domain={["dataMin - 20", "dataMax + 20"]}
            tickFormatter={(v: number) => fmtNum(v)} />
          <Tooltip cursor={{ stroke: t.line }} content={<TooltipBox xFormat={(v) => `${fmtNum(Number(v), 1)} km`} yFormat={(v) => `${fmtNum(v)} m`} />} />
          <Area type="monotone" dataKey="alt" name="Altitud" stroke={color} fill={color} fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const ZONE_NAMES = ["Z1 Recuperación", "Z2 Aeróbica", "Z3 Tempo", "Z4 Umbral", "Z5 VO2 máx", "Z6 Anaeróbica", "Z7 Máxima"];

export function ZoneBars({ times, bounds }: { times: number[] | null; bounds?: number[] | null }) {
  if (!times || !times.some((x) => x > 0)) return <p className="muted small">Sin datos de tiempo en zonas.</p>;
  const total = times.reduce((a, b) => a + b, 0);
  const max = Math.max(...times);
  return (
    <div className="zones" role="table" aria-label="Tiempo en zonas de frecuencia cardiaca">
      {times.map((v, i) => {
        const lo = i === 0 ? null : bounds?.[i - 1];
        const hi = bounds?.[i];
        const range = bounds ? (i === 0 ? `<${hi}` : hi ? `${lo}–${hi}` : `>${lo}`) : "";
        return (
          <div className="zone" role="row" key={i}>
            <span role="cell" title={range ? `${range} ppm` : undefined}>{ZONE_NAMES[i] ?? `Z${i + 1}`}</span>
            <span className="track" role="cell"><span className="fill" style={{ width: `${max ? (v / max) * 100 : 0}%`, opacity: 0.45 + (i / 10) }} /></span>
            <span className="v" role="cell">{fmtDuration(v, { short: true })}</span>
            <span className="v" role="cell">{total ? `${fmtNum((v / total) * 100)} %` : "–"}</span>
          </div>
        );
      })}
      {bounds && <p className="muted tiny">Zonas de frecuencia cardiaca configuradas en el origen de los datos.</p>}
    </div>
  );
}

export function IntensityMix({ zones }: { zones: number[] | null }) {
  const t = useChartTheme();
  const mix = intensityMix(zones);
  if (!mix) return <p className="muted small">Sin datos de zonas en este periodo.</p>;
  const parts = [
    { k: "Baja (Z1–Z2)", v: mix.low, c: t.info },
    { k: "Media (Z3–Z4)", v: mix.mid, c: t.warn },
    { k: "Alta (Z5+)", v: mix.high, c: t.crit },
  ];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="mixbar" aria-hidden="true">
        {parts.map((p) => <span key={p.k} style={{ width: `${p.v * 100}%`, background: p.c }} />)}
      </div>
      <div className="row" style={{ gap: 14 }}>
        {parts.map((p) => (
          <span key={p.k} className="small ink2" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: p.c }} />{p.k}
            <b className="num" style={{ color: "var(--ink)" }}>{fmtNum(p.v * 100)} %</b>
          </span>
        ))}
      </div>
    </div>
  );
}
