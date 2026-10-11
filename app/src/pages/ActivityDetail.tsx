import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ElevationChart, HrChart, ZoneBars } from "../components/charts";
import { Icon } from "../components/icons";
import { intensityLabel } from "../components/Sessions";
import { Card, Empty, Field, OriginBadge, SportChip, Stat } from "../components/ui";
import { useApp } from "../data/AppData";
import { fmtDateTime, fmtDay, fmtDayLong, fmtTime } from "../lib/dates";
import {
  fmtClock, fmtDistance, fmtDuration, fmtElevation, fmtHr, fmtNum, fmtPace, fmtSpeed, isNum,
} from "../lib/format";
import { durationOf, intensityBucket, similarSessions } from "../lib/metrics";
import { isBike, SPORT_DESCRIPTION, SPORT_LABEL, SPORTS, sourceTypeLabel, sportColor } from "../lib/sports";
import type { Activity, Feedback, Sport, StrengthSet, Streams } from "../lib/types";

const MapView = lazy(() => import("../components/MapView"));

function splitsPerKm(s: Streams): { km: number; secs: number }[] {
  if (!s.distance || !s.time || s.distance.length !== s.time.length) return [];
  const out: { km: number; secs: number }[] = [];
  let next = 1000, lastT = 0;
  for (let i = 0; i < s.distance.length; i++) {
    if (s.distance[i] >= next) {
      out.push({ km: next / 1000, secs: s.time[i] - lastT });
      lastT = s.time[i];
      next += 1000;
    }
  }
  return out;
}

function FeedbackForm({ a }: { a: Activity }) {
  const { data, run } = useApp();
  const existing = data.feedback[a.id];
  const [f, setF] = useState<Feedback>(existing ?? {
    activity_id: a.id, rpe: null, sensations: null, notes: null, terrain_notes: null,
    ebike_battery_start_pct: null, ebike_battery_end_pct: null, ebike_assist_notes: null,
  });
  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <Card title="Esfuerzo percibido y sensaciones" action={existing ? <OriginBadge origin="manual" /> : null}>
      <div className="form-grid">
        <Field label="Esfuerzo percibido (RPE 1–10)" full>
          <div className="scale" style={{ gridTemplateColumns: "repeat(10, 1fr)" }} role="radiogroup" aria-label="RPE">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" aria-pressed={f.rpe === n} onClick={() => setF({ ...f, rpe: n })}>{n}</button>
            ))}
          </div>
        </Field>
        <Field label="Sensaciones" full><textarea className="input" value={f.sensations ?? ""} onChange={(e) => setF({ ...f, sensations: e.target.value || null })} /></Field>
        {isBike(a.category) && (
          <Field label="Terreno y condiciones" full><input className="input" value={f.terrain_notes ?? ""} onChange={(e) => setF({ ...f, terrain_notes: e.target.value || null })} /></Field>
        )}
        {a.category === "emtb" && (
          <>
            <Field label="Batería al salir (%)" hint="Registro manual"><input className="input" type="number" min={0} max={100} value={f.ebike_battery_start_pct ?? ""} onChange={(e) => setF({ ...f, ebike_battery_start_pct: num(e.target.value) })} /></Field>
            <Field label="Batería al llegar (%)" hint="Registro manual"><input className="input" type="number" min={0} max={100} value={f.ebike_battery_end_pct ?? ""} onChange={(e) => setF({ ...f, ebike_battery_end_pct: num(e.target.value) })} /></Field>
            <Field label="Modos de asistencia usados" full><input className="input" value={f.ebike_assist_notes ?? ""} onChange={(e) => setF({ ...f, ebike_assist_notes: e.target.value || null })} placeholder="Ej.: Eco en llano, Trail en subidas" /></Field>
          </>
        )}
        <Field label="Notas" full><textarea className="input" value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value || null })} /></Field>
      </div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => run((r) => r.saveFeedback(f), "Guardado")}>Guardar</button></div>
    </Card>
  );
}

function StrengthLog({ a }: { a: Activity }) {
  const { repo, notify } = useApp();
  const [sets, setSets] = useState<StrengthSet[] | null>(null);
  useEffect(() => { repo?.getStrengthSets(a.id).then(setSets).catch(() => setSets([])); }, [repo, a.id]);
  if (!sets) return null;
  const upd = (i: number, patch: Partial<StrengthSet>) => setSets(sets.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = () => {
    const last = sets[sets.length - 1];
    setSets([...sets, { exercise: last?.exercise ?? "", set_number: last ? last.set_number + 1 : 1, reps: last?.reps ?? null, weight_kg: last?.weight_kg ?? null, duration_s: null, notes: null }]);
  };
  const save = async () => {
    try {
      await repo?.saveStrengthSets(a.id, sets.filter((s) => s.exercise.trim()));
      notify("Ejercicios guardados");
    } catch (e) { notify(e instanceof Error ? e.message : String(e), "error"); }
  };
  const n = (v: string) => (v === "" ? null : Number(v));
  const volume = sets.reduce((acc, s) => acc + (s.reps ?? 0) * (s.weight_kg ?? 0), 0);
  return (
    <Card title="Ejercicios, series y pesos" action={<span className="small muted">Volumen: {volume ? `${fmtNum(volume)} kg` : "Sin datos"}</span>}>
      {sets.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Ejercicio</th><th className="n">Serie</th><th className="n">Reps</th><th className="n">Kg</th><th className="n">Seg.</th><th /></tr></thead>
            <tbody>
              {sets.map((s, i) => (
                <tr key={i}>
                  <td><input className="input" value={s.exercise} onChange={(e) => upd(i, { exercise: e.target.value })} placeholder="Sentadilla en rack" /></td>
                  <td className="n"><input className="input" style={{ width: 64 }} type="number" min={1} value={s.set_number} onChange={(e) => upd(i, { set_number: Number(e.target.value) || 1 })} /></td>
                  <td className="n"><input className="input" style={{ width: 70 }} type="number" min={0} value={s.reps ?? ""} onChange={(e) => upd(i, { reps: n(e.target.value) })} /></td>
                  <td className="n"><input className="input" style={{ width: 80 }} type="number" min={0} step={0.5} value={s.weight_kg ?? ""} onChange={(e) => upd(i, { weight_kg: n(e.target.value) })} /></td>
                  <td className="n"><input className="input" style={{ width: 76 }} type="number" min={0} value={s.duration_s ?? ""} onChange={(e) => upd(i, { duration_s: n(e.target.value) })} /></td>
                  <td><button className="btn ghost sm" onClick={() => setSets(sets.filter((_, j) => j !== i))} aria-label="Quitar serie"><Icon name="trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="small muted">Aún no has registrado ejercicios para esta sesión.</p>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={add}><Icon name="plus" />Añadir serie</button>
        <button className="btn primary" onClick={save}>Guardar ejercicios</button>
      </div>
    </Card>
  );
}

function Compare({ a }: { a: Activity }) {
  const { data, units } = useApp();
  const sim = similarSessions(data.activities, a, 6);
  const rows = [a, ...sim];
  const bike = isBike(a.category);
  return (
    <Card title={`Comparar con sesiones de ${SPORT_LABEL[a.category]}`}>
      {sim.length ? (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Fecha</th><th className="n">Duración</th><th className="n">FC media</th><th className="n">Carga</th>
                {(bike || a.category === "run") && <><th className="n">Distancia</th><th className="n">Desnivel</th></>}
                {a.category === "run" && <th className="n">Ritmo</th>}
                <th className="n">Z1–Z2</th><th className="n">RPE</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const z = r.hr_zone_times_s;
                  const tot = z?.reduce((x, y) => x + y, 0) ?? 0;
                  const low = z && tot ? ((z[0] + (z[1] ?? 0)) / tot) * 100 : null;
                  return (
                    <tr key={r.id} style={r.id === a.id ? { background: "var(--surface-2)" } : undefined}>
                      <td>{r.id === a.id ? <b>Esta sesión</b> : <Link to={`/actividades/${r.id}`}>{fmtDay(r.local_date)} {r.local_date.slice(0, 4)}</Link>}</td>
                      <td className="n">{fmtDuration(durationOf(r), { short: true })}</td>
                      <td className="n">{fmtHr(r.avg_hr)}</td>
                      <td className="n">{fmtNum(r.training_load)}</td>
                      {(bike || a.category === "run") && <><td className="n">{fmtDistance(r.distance_m, units)}</td><td className="n">{fmtElevation(r.elevation_gain_m, units)}</td></>}
                      {a.category === "run" && <td className="n">{fmtPace(r.avg_speed_ms, units)}</td>}
                      <td className="n">{low !== null ? `${fmtNum(low)} %` : "Sin datos"}</td>
                      <td className="n">{data.feedback[r.id]?.rpe ?? "Sin datos"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {a.category === "emtb" && <p className="chart-note">En e-MTB, más velocidad o distancia no indica por sí sola una mejora física: depende de la asistencia. Compara frecuencia cardiaca, tiempo en zonas y esfuerzo percibido.</p>}
          {a.category === "hiit" && <p className="chart-note">En HIIT, compara también el esfuerzo percibido y el trabajo registrado (series y pesos), no solo la frecuencia cardiaca.</p>}
        </>
      ) : <p className="small muted">No hay otras sesiones de {SPORT_LABEL[a.category]} para comparar todavía.</p>}
    </Card>
  );
}

export default function ActivityDetail() {
  const { id } = useParams();
  const { data, repo, run, theme, units, tz, mode } = useApp();
  const nav = useNavigate();
  const a = data.activities.find((x) => x.id === id);
  const [streams, setStreams] = useState<Streams | null | undefined>(undefined);

  useEffect(() => {
    if (!a || !repo) return;
    setStreams(undefined);
    repo.getStreams(a.id).then(setStreams).catch(() => setStreams(null));
  }, [a?.id, repo]); // eslint-disable-line react-hooks/exhaustive-deps

  const splits = useMemo(() => (streams && a?.category === "run" ? splitsPerKm(streams) : []), [streams, a?.category]);

  if (!a) return <Empty title="Actividad no encontrada" action={<Link className="btn" to="/actividades">Volver a actividades</Link>} />;

  const color = sportColor(a.category, theme);
  const bike = isBike(a.category);
  const garmin = (a.device_name ?? "").toLowerCase().includes("garmin");
  const setCategory = (c: Sport | null) => run((r) => r.setCategoryOverride(a.id, c), c ? `Clasificada como ${SPORT_LABEL[c]}` : "Categoría automática restablecida");

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <Link to="/actividades" className="btn ghost sm"><Icon name="back" />Actividades</Link>
      </div>
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <div className="row"><SportChip cat={a.category} /><OriginBadge origin={a.data_origin === "manual" ? "manual" : "medido"} />
            {a.source === "import" && <span className="badge">Importada desde archivo</span>}
            {intensityBucket(a) && <span className="badge">Intensidad {intensityLabel(intensityBucket(a)).toLowerCase()}</span>}</div>
          <h1>{a.name || SPORT_LABEL[a.category]}</h1>
          <div className="sub">{fmtDayLong(a.local_date)}{a.start_time ? ` · ${fmtTime(a.start_time, tz)}` : ""} · {a.device_name ?? "Dispositivo desconocido"} · {mode === "demo" ? "Datos de demostración" : a.source === "intervals" ? `Intervals.icu${a.last_synced_at ? ` (sincronizado ${fmtDateTime(a.last_synced_at, tz)})` : ""}` : "Archivo importado"}</div>
        </div>
      </div>

      {(a.category_needs_review || a.api_restricted) && (
        <Card pad className="">
          {a.category_needs_review && <p className="status warn"><Icon name="alert" />El tipo de origen («{sourceTypeLabel(a.source_type)}») es ambiguo. Indica la categoría correcta abajo.</p>}
          {a.api_restricted && <p className="status warn"><Icon name="alert" />Intervals.icu no ha devuelto todos los datos de esta actividad (posible restricción de datos de Garmin por API). Puedes importar el archivo FIT original.</p>}
        </Card>
      )}

      <div className="split" style={{ marginTop: 14 }}>
        <div className="stack">
          <div className="grid stats">
            <Stat label="Duración" value={fmtDuration(a.duration_s, { short: true })} foot={bike || a.category === "run" ? `En movimiento: ${fmtDuration(a.moving_time_s, { short: true })}` : undefined} />
            <Stat label="FC media" value={isNum(a.avg_hr) ? Math.round(a.avg_hr) : null} unit="ppm" foot={`Máxima: ${fmtHr(a.max_hr)}`} />
            <Stat label="Carga" value={isNum(a.training_load) ? fmtNum(a.training_load) : null} foot="Calculada por Intervals.icu" />
            <Stat label="Calorías" value={isNum(a.calories) ? fmtNum(a.calories) : null} unit="kcal" badge={<OriginBadge origin="estimado" />} />
            {(bike || a.category === "run") && <>
              <Stat label="Distancia" value={isNum(a.distance_m) ? fmtDistance(a.distance_m, units) : null} />
              <Stat label="Desnivel positivo" value={isNum(a.elevation_gain_m) ? fmtElevation(a.elevation_gain_m, units) : null} />
              {a.category === "run"
                ? <Stat label="Ritmo medio" value={isNum(a.avg_speed_ms) ? fmtPace(a.avg_speed_ms, units) : null} />
                : <Stat label="Velocidad media" value={isNum(a.avg_speed_ms) ? fmtSpeed(a.avg_speed_ms, units) : null}
                  foot={a.category === "emtb" ? "Depende de la asistencia: no mide forma física" : undefined} />}
              <Stat label="Cadencia media" value={isNum(a.avg_cadence) ? fmtNum(a.avg_cadence) : null} unit={a.category === "run" ? "ppm" : "rpm"} />
            </>}
            {bike && (
              <Stat label="Potencia del ciclista" value={a.rider_power_source === "medidor" && isNum(a.rider_avg_power_w) ? fmtNum(a.rider_avg_power_w) : null} unit="W"
                foot={a.rider_power_source === "medidor" ? "Medidor de potencia" : a.rider_power_source === "estimado" ? "Solo hay una estimación del origen: no se muestra" : "Sin medidor de potencia"} />
            )}
          </div>

          <Card title="Frecuencia cardiaca">
            {streams === undefined ? <p className="small muted">Cargando serie temporal…</p>
              : streams?.time && streams.heartrate ? <HrChart time={streams.time} hr={streams.heartrate} bounds={a.hr_zone_bounds} />
                : <p className="small muted">Sin serie temporal de frecuencia cardiaca.</p>}
          </Card>

          <Card title="Tiempo en zonas">
            <ZoneBars times={a.hr_zone_times_s} bounds={a.hr_zone_bounds} />
          </Card>

          {(bike || a.category === "run") && (
            <Card title="Recorrido y elevación">
              {streams?.latlng && streams.latlng.length > 1 ? (
                <Suspense fallback={<p className="small muted">Cargando mapa…</p>}><MapView points={streams.latlng} color={color} /></Suspense>
              ) : <p className="small muted">Sin datos GPS para esta actividad.</p>}
              {streams?.altitude && streams.distance ? (
                <div style={{ marginTop: 12 }}><ElevationChart distance={streams.distance} altitude={streams.altitude} color={color} /></div>
              ) : <p className="small muted" style={{ marginTop: 8 }}>Sin perfil de elevación.</p>}
            </Card>
          )}

          {a.category === "run" && splits.length > 0 && (
            <Card title="Parciales por kilómetro">
              <table className="data"><thead><tr><th>Km</th><th className="n">Tiempo del kilómetro (ritmo)</th></tr></thead>
                <tbody>{splits.map((s) => <tr key={s.km}><td>{s.km}</td><td className="n">{fmtClock(s.secs)} /km</td></tr>)}</tbody>
              </table>
            </Card>
          )}

          {(a.category === "hiit" || a.category === "otro") && <StrengthLog a={a} />}
          <Compare a={a} />
        </div>

        <div className="stack">
          <Card title="Clasificación">
            <div className="stack" style={{ gap: 10 }}>
              <p className="small ink2">Tipo original: <b>{sourceTypeLabel(a.source_type)}</b>{a.source_type ? <span className="muted"> ({a.source_type})</span> : null}</p>
              <p className="small ink2">Categoría automática: <b>{SPORT_LABEL[a.category_auto]}</b>{a.category_override && <> · Corregida a <b>{SPORT_LABEL[a.category_override]}</b></>}</p>
              <Field label="Categoría" hint="Tu corrección se conserva aunque la actividad se vuelva a sincronizar.">
                <select className="input" value={a.category_override ?? ""} onChange={(e) => setCategory((e.target.value || null) as Sport | null)}>
                  <option value="">Automática ({SPORT_LABEL[a.category_auto]})</option>
                  {SPORTS.map((s) => <option key={s} value={s}>{SPORT_LABEL[s]} — {SPORT_DESCRIPTION[s]}</option>)}
                </select>
              </Field>
            </div>
          </Card>
          <FeedbackForm a={a} />
          {garmin && <p className="tiny muted">Datos registrados con un dispositivo Garmin.</p>}
          {a.source === "import" && (
            <button className="btn danger" onClick={async () => {
              if (!confirm("¿Eliminar esta actividad importada?")) return;
              await run((r) => r.deleteImportedActivity(a.id), "Actividad eliminada");
              nav("/actividades");
            }}><Icon name="trash" />Eliminar actividad importada</button>
          )}
        </div>
      </div>
    </>
  );
}
