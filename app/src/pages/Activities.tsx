import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/icons";
import { PageHead } from "../components/Layout";
import { ActivityRow } from "../components/Sessions";
import { WodImportModal } from "../components/WodImport";
import { Card, Empty, Field, Modal } from "../components/ui";
import { useApp } from "../data/AppData";
import { addDays, fmtDayLong } from "../lib/dates";
import { fmtDistance, fmtDuration, fmtElevation, fmtHr } from "../lib/format";
import { parseActivityFile } from "../lib/importers";
import { durationOf, intensityBucket } from "../lib/metrics";
import { SPORT_DESCRIPTION, SPORT_LABEL, SPORTS } from "../lib/sports";
import type { Intensity, ParsedImport, Sport } from "../lib/types";

function ImportModal({ onClose }: { onClose: () => void }) {
  const { run, data, units } = useApp();
  const nav = useNavigate();
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<Sport | "">("");
  const [name, setName] = useState("");
  const [force, setForce] = useState(false);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setParsed(null); setBusy(true);
    try {
      const p = await parseActivityFile(f);
      setParsed(p);
      setCat(p.suggested === "otro" ? "" : p.suggested);
      setName(f.name.replace(/\.(fit|gpx|tcx)$/i, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally { setBusy(false); }
  };

  const duplicate = useMemo(() => {
    if (!parsed?.startTime) return null;
    const t = Date.parse(parsed.startTime);
    return data.activities.find((a) => a.start_time && Math.abs(Date.parse(a.start_time) - t) < 10 * 60 * 1000) ?? null;
  }, [parsed, data.activities]);

  const save = async () => {
    if (!parsed || !cat) return;
    const id = await run((r) => r.importActivity(parsed, cat, name || SPORT_LABEL[cat]), "Actividad importada");
    if (id) { onClose(); nav(`/actividades/${id}`); }
  };

  return (
    <Modal title="Importar actividad desde archivo" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!parsed || !cat || (Boolean(duplicate) && !force)} onClick={save}>Importar</button>
      </>
    }>
      <div className="stack">
        <p className="small ink2">Archivos compatibles: FIT (Garmin), GPX y TCX. El archivo se procesa en tu navegador y solo se guardan los datos de la actividad. Útil si Intervals.icu deja de ofrecer por API los datos de Garmin.</p>
        <input className="input" type="file" accept=".fit,.gpx,.tcx" onChange={(e) => onFile(e.target.files?.[0])} />
        {busy && <p className="small muted">Leyendo archivo…</p>}
        {error && <p className="small" style={{ color: "var(--crit)" }} role="alert">{error}</p>}
        {parsed && (
          <>
            <table className="data">
              <tbody>
                <tr><td>Fecha</td><td>{fmtDayLong(parsed.localDate)}</td></tr>
                <tr><td>Tipo en el archivo</td><td>{parsed.sourceType || "Sin datos"}</td></tr>
                <tr><td>Duración</td><td>{fmtDuration(parsed.movingTimeS ?? parsed.durationS)}</td></tr>
                <tr><td>Distancia</td><td>{fmtDistance(parsed.distanceM, units)}</td></tr>
                <tr><td>Desnivel positivo</td><td>{fmtElevation(parsed.elevationGainM, units)}</td></tr>
                <tr><td>FC media / máx.</td><td>{fmtHr(parsed.avgHr)} / {fmtHr(parsed.maxHr)}</td></tr>
                <tr><td>Series temporales</td><td>{Object.keys(parsed.streams).join(", ") || "Ninguna"}</td></tr>
              </tbody>
            </table>
            <Field label="Categoría (obligatoria)" hint={parsed.suggestedReason}>
              <select className="input" value={cat} onChange={(e) => setCat(e.target.value as Sport)}>
                <option value="">Elige…</option>
                {SPORTS.map((s) => <option key={s} value={s}>{SPORT_LABEL[s]} — {SPORT_DESCRIPTION[s]}</option>)}
              </select>
            </Field>
            <Field label="Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            {duplicate && (
              <div className="proposal" style={{ borderColor: "var(--warn)" }}>
                <span className="status warn"><Icon name="alert" />Posible duplicado de «{duplicate.name ?? SPORT_LABEL[duplicate.category]}» ({fmtDayLong(duplicate.local_date)}), que empieza a menos de 10 minutos.</span>
                <label className="row small"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Importar igualmente</label>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export default function Activities() {
  const { data, today } = useApp();
  const [q, setQ] = useState("");
  const [sport, setSport] = useState<Sport | "todos">("todos");
  const [from, setFrom] = useState(addDays(today, -365));
  const [to, setTo] = useState(today);
  const [minMin, setMinMin] = useState("");
  const [maxMin, setMaxMin] = useState("");
  const [intensity, setIntensity] = useState<Intensity | "todas" | "sin">("todas");
  const [importing, setImporting] = useState(false);
  const [pastingWod, setPastingWod] = useState(false);
  const nav = useNavigate();

  const list = useMemo(() => data.activities
    .filter((a) => a.local_date >= from && a.local_date <= to)
    .filter((a) => sport === "todos" || a.category === sport)
    .filter((a) => !q || (a.name ?? "").toLowerCase().includes(q.toLowerCase()))
    .filter((a) => {
      const m = (durationOf(a) ?? 0) / 60;
      return (!minMin || m >= Number(minMin)) && (!maxMin || m <= Number(maxMin));
    })
    .filter((a) => {
      if (intensity === "todas") return true;
      const b = intensityBucket(a);
      return intensity === "sin" ? b === null : b === intensity;
    })
    .sort((a, b) => b.local_date.localeCompare(a.local_date) || (b.start_time ?? "").localeCompare(a.start_time ?? "")),
  [data.activities, from, to, sport, q, minMin, maxMin, intensity]);

  const review = data.activities.filter((a) => a.category_needs_review);

  return (
    <>
      <PageHead title="Actividades" sub={`${list.length} de ${data.activities.length} actividades`}
        actions={<>
          <button className="btn primary" onClick={() => setPastingWod(true)}><Icon name="plus" />Pegar WOD</button>
          <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" />Importar archivo</button>
        </>} />

      {review.length > 0 && (
        <Card className="" pad>
          <span className="status warn"><Icon name="alert" />{review.length} actividad(es) con un tipo de origen ambiguo. Ábrelas para indicar si fueron MTB, e-MTB u otra categoría; tu corrección se conserva en futuras sincronizaciones.</span>
        </Card>
      )}

      <Card className="" pad>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          <Field label="Buscar"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre…" /></Field>
          <Field label="Deporte">
            <select className="input" value={sport} onChange={(e) => setSport(e.target.value as Sport | "todos")}>
              <option value="todos">Todos</option>
              {SPORTS.map((s) => <option key={s} value={s}>{SPORT_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Desde"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Duración mín. (min)"><input className="input" type="number" min={0} value={minMin} onChange={(e) => setMinMin(e.target.value)} /></Field>
          <Field label="Duración máx. (min)"><input className="input" type="number" min={0} value={maxMin} onChange={(e) => setMaxMin(e.target.value)} /></Field>
          <Field label="Intensidad" hint="Según % de tiempo en Z4 o superior">
            <select className="input" value={intensity} onChange={(e) => setIntensity(e.target.value as typeof intensity)}>
              <option value="todas">Todas</option><option value="suave">Suave</option><option value="moderada">Moderada</option>
              <option value="alta">Alta</option><option value="sin">Sin datos de zonas</option>
            </select>
          </Field>
        </div>
      </Card>

      <div style={{ height: 14 }} />
      <section className="card">
        {list.length ? <div className="list">{list.map((a) => <ActivityRow key={a.id} a={a} />)}</div>
          : <Empty title="No hay actividades con estos filtros">Amplía el rango de fechas o importa un archivo.</Empty>}
      </section>
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {pastingWod && <WodImportModal onClose={() => setPastingWod(false)} onSaved={(id) => { if (id) nav(`/actividades/${id}`); }} />}
    </>
  );
}
