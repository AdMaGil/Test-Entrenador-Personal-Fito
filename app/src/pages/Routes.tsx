// Rutas: seguimiento exclusivo de MTB y e-MTB — lista comparativa y mapa
// agregado. Usa la categoría y el GPS que ya trae cada actividad (Intervals.icu
// o la importación manual de FIT/GPX/TCX); no reclasifica ni inventa nada.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { lazy, Suspense } from "react";
import { StackedBars, useChartTheme } from "../components/charts";
import { Icon } from "../components/icons";
import { PageHead } from "../components/Layout";
import { Card, Empty, Segmented, SportChip, Stat } from "../components/ui";
import { useApp } from "../data/AppData";
import { addDays, fmtDay, fmtDayLong } from "../lib/dates";
import { fmtDistance, fmtDuration, fmtElevation, fmtHr, fmtSpeed, isNum } from "../lib/format";
import { monthlyDistance, routeActivities, routeStats, type RouteCategory } from "../lib/routes";
import { sportColor } from "../lib/sports";
import type { Activity } from "../lib/types";
import type { RouteLine } from "../components/RoutesMap";

const RoutesMap = lazy(() => import("../components/RoutesMap"));

type Filter = RouteCategory | "todas";
type Span = "90" | "365" | "todo";

export default function Routes() {
  const { data, today, units, theme, repo } = useApp();
  const [filter, setFilter] = useState<Filter>("todas");
  const [span, setSpan] = useState<Span>("365");
  const [lines, setLines] = useState<Map<string, [number, number][]>>(new Map());

  const from = span === "todo" ? undefined : addDays(today, -(Number(span) - 1));
  const routes = useMemo(() => routeActivities(data.activities, filter, from), [data.activities, filter, from]);
  const stats = useMemo(() => routeStats(routes), [routes]);
  const monthly = useMemo(() => monthlyDistance(routeActivities(data.activities, "todas", from)), [data.activities, from]);
  const t = useChartTheme();

  const withGps = useMemo(() => routes.filter((a) => a.has_gps), [routes]);
  const MAX_MAP_ROUTES = 80;
  const mapSet = withGps.slice(0, MAX_MAP_ROUTES);

  useEffect(() => {
    if (!repo) return;
    let alive = true;
    const pending = mapSet.filter((a) => !lines.has(a.id));
    if (!pending.length) return;
    Promise.all(pending.map((a) => repo.getStreams(a.id).then((s) => [a.id, s?.latlng ?? []] as const)))
      .then((pairs) => {
        if (!alive) return;
        setLines((prev) => {
          const next = new Map(prev);
          for (const [id, pts] of pairs) next.set(id, pts);
          return next;
        });
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, mapSet.map((a) => a.id).join(",")]);

  const mapRoutes: RouteLine[] = mapSet
    .map((a) => ({ id: a.id, points: lines.get(a.id) ?? [], color: sportColor(a.category, theme), label: `${a.name ?? sportLabel(a)} · ${fmtDay(a.local_date)}` }))
    .filter((r) => r.points.length > 1);
  const mapLoading = mapSet.some((a) => !lines.has(a.id));

  return (
    <>
      <PageHead title="Rutas MTB / e-MTB" sub="Solo tus salidas de montaña: en bici normal o con asistencia eléctrica"
        actions={<>
          <Segmented label="Categoría" value={filter} onChange={setFilter}
            options={[{ value: "todas", label: "Todas" }, { value: "emtb", label: "e-MTB" }, { value: "mtb", label: "MTB" }]} />
          <Segmented label="Periodo" value={span} onChange={setSpan}
            options={[{ value: "90", label: "90 días" }, { value: "365", label: "1 año" }, { value: "todo", label: "Todo" }]} />
        </>} />

      <div className="grid stats" style={{ marginBottom: 14 }}>
        <Stat label="Salidas" value={stats.count || null} foot={stats.count ? `${stats.withGps} con GPS` : "Sin salidas en el periodo"} />
        <Stat label="Distancia total" value={stats.km !== null ? fmtDistance(stats.km * 1000, units) : null} />
        <Stat label="Desnivel acumulado" value={stats.elevationM !== null ? fmtElevation(stats.elevationM, units) : null} />
        <Stat label="Tiempo total" value={stats.timeS ? fmtDuration(stats.timeS, { short: true }) : null} />
        <Stat label="Velocidad media" value={stats.avgSpeedMs !== null ? fmtSpeed(stats.avgSpeedMs, units) : null} foot="Ponderada por distancia" />
      </div>

      <Card title="Mapa de rutas" action={mapLoading ? <span className="small muted">Cargando trazados…</span> : undefined}>
        {withGps.length > 0 ? (
          <>
            <Suspense fallback={<p className="small muted">Cargando mapa…</p>}>
              <RoutesMap routes={mapRoutes} />
            </Suspense>
            {withGps.length > MAX_MAP_ROUTES && (
              <p className="tiny muted" style={{ marginTop: 8 }}>Se muestran las {MAX_MAP_ROUTES} salidas con GPS más recientes de {withGps.length}; estrecha el periodo para ver otras.</p>
            )}
            {routes.length > withGps.length && (
              <p className="tiny muted" style={{ marginTop: 8 }}>{routes.length - withGps.length} salida(s) del listado no tienen traza GPS y no aparecen en el mapa.</p>
            )}
          </>
        ) : <Empty title="Sin trazas GPS en el periodo">Las salidas sincronizadas desde Intervals.icu o importadas desde un archivo FIT/GPX traen el recorrido automáticamente.</Empty>}
      </Card>

      {monthly.length > 1 && (
        <Card title="Distancia por mes" action={<Link to="/evolucion" className="btn ghost sm">Entrenamiento<Icon name="chevron" /></Link>}>
          <StackedBars data={monthly} xKey="month" ariaLabel="Kilómetros de MTB y e-MTB por mes"
            xFormat={(v) => String(v).slice(5)} yFormat={(v) => `${v} km`}
            series={[{ key: "emtb", label: "e-MTB", color: t.info }, { key: "mtb", label: "MTB", color: t.ok }]} />
        </Card>
      )}

      <Card title="Salidas">
        {routes.length ? (
          <div className="route-table">
            <div className="route-row route-head small muted">
              <span>Fecha</span><span>Ruta</span><span>Distancia</span><span>Desnivel</span><span>Duración</span><span>Vel. media</span><span>FC media</span>
            </div>
            {routes.map((a) => <RouteRow key={a.id} a={a} units={units} theme={theme} />)}
          </div>
        ) : <Empty title="Sin salidas en el periodo">Prueba a ampliar el periodo o cambiar la categoría.</Empty>}
      </Card>
    </>
  );
}

function sportLabel(a: Activity): string {
  return a.category === "emtb" ? "e-MTB" : "MTB";
}

function RouteRow({ a, units, theme }: { a: Activity; units: ReturnType<typeof useApp>["units"]; theme: "dark" | "light" }) {
  return (
    <Link to={`/actividades/${a.id}`} className="route-row touch">
      <span className="small">{fmtDayLong(a.local_date)}</span>
      <span className="row" style={{ gap: 6, minWidth: 0 }}>
        <span className="bar" style={{ background: sportColor(a.category, theme), width: 3, height: 16, borderRadius: 2, flex: "none" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name ?? sportLabel(a)}</span>
        <SportChip cat={a.category} short />
        {!a.has_gps && <span className="badge muted-badge">Sin GPS</span>}
      </span>
      <span className="num">{fmtDistance(a.distance_m, units)}</span>
      <span className="num">{fmtElevation(a.elevation_gain_m, units)}</span>
      <span className="num">{fmtDuration(a.moving_time_s ?? a.duration_s, { short: true })}</span>
      <span className="num">{isNum(a.avg_speed_ms) ? fmtSpeed(a.avg_speed_ms, units) : "–"}</span>
      <span className="num">{fmtHr(a.avg_hr)}</span>
    </Link>
  );
}
