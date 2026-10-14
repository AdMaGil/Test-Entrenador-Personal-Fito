import { useEffect, useMemo, useState } from "react";
import { LineChartBox, StackedBars, useChartTheme } from "../components/charts";
import { Icon } from "../components/icons";
import { PageHead } from "../components/Layout";
import { FeelfitImportModal } from "../components/FeelfitImport";
import { Card, Empty, Field, Modal, OriginBadge, Segmented, Stat } from "../components/ui";
import { useApp } from "../data/AppData";
import { addDays, diffDays, fmtDay, fmtDayLong, startOfWeek } from "../lib/dates";
import { fmtNum, fmtWeight, isNum } from "../lib/format";
import { inRange, nearestBodyFat, nearestMeasurement, realBodyFat, realWeights, summarize } from "../lib/metrics";
import { PHOTO_GUIDE, POSE_LABEL, POSES } from "../lib/photos";
import type { Framing, Measurement, PhotoEntry, PhotoFile, Pose } from "../lib/types";

function useSignedUrl(path: string | null | undefined) {
  const { repo } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null); setErr(false);
    if (!path || !repo) return;
    repo.photoUrl(path).then((u) => alive && setUrl(u)).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [path, repo]);
  return { url, err };
}

/** Escala uniforme + desplazamiento: nunca deforma el cuerpo (object-fit: contain). */
export function FramedPhoto({ file, framing, alt }: { file: PhotoFile; framing?: Framing; alt: string }) {
  const { url, err } = useSignedUrl(file.display_path ?? file.original_path);
  const f = framing ?? file.framing ?? { scale: 1, x: 0, y: 0 };
  if (err) return <div className="photo-frame" style={{ display: "grid", placeItems: "center", color: "#aaa", fontSize: 12 }}>Vista previa no disponible</div>;
  return (
    <div className="photo-frame">
      {url && <img src={url} alt={alt} draggable={false} style={{ transform: `translate(${f.x}%, ${f.y}%) scale(${f.scale})` }} />}
    </div>
  );
}

function Thumb({ file }: { file: PhotoFile }) {
  const { url } = useSignedUrl(file.display_path ?? file.original_path);
  return <div className="thumb">{url && <img src={url} alt={`Foto ${POSE_LABEL[file.pose].toLowerCase()}`} />}</div>;
}

async function download(repo: ReturnType<typeof useApp>["repo"], file: PhotoFile, date: string) {
  if (!repo) return;
  const ext = file.original_path.split(".").pop() || "jpg";
  const url = await repo.photoUrl(file.original_path, { download: `evolucion-${date}-${file.pose}.${ext}` });
  const a = document.createElement("a");
  a.href = url;
  a.download = `evolucion-${date}-${file.pose}.${ext}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function FramingEditor({ file, onClose }: { file: PhotoFile; onClose: () => void }) {
  const { run } = useApp();
  const [f, setF] = useState<Framing>(file.framing ?? { scale: 1, x: 0, y: 0 });
  return (
    <Modal title={`Ajustar encuadre · ${POSE_LABEL[file.pose]}`} onClose={onClose} footer={<>
      <button className="btn" onClick={() => setF({ scale: 1, x: 0, y: 0 })}>Restablecer</button>
      <span style={{ flex: 1 }} />
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" onClick={async () => { await run((r) => r.updateFraming(file.id, f), "Encuadre guardado"); onClose(); }}>Guardar</button></>}>
      <div className="grid cols-2">
        <div className="compare" style={{ width: "100%", maxHeight: "60vh" }}><FramedPhoto file={file} framing={f} alt="Vista previa del encuadre" />
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.18) 1px, transparent 1px)", backgroundSize: "33.33% 25%" }} />
        </div>
        <div className="stack">
          <p className="small ink2">La escala es la misma en horizontal y vertical, así que la imagen nunca se deforma. Usa la cuadrícula para alinear cabeza, cintura y pies entre fechas.</p>
          <Field label={`Escala · ${fmtNum(f.scale, 2)}×`}><input type="range" min={0.6} max={2.5} step={0.01} value={f.scale} onChange={(e) => setF({ ...f, scale: Number(e.target.value) })} /></Field>
          <Field label={`Horizontal · ${fmtNum(f.x, 1)} %`}><input type="range" min={-40} max={40} step={0.5} value={f.x} onChange={(e) => setF({ ...f, x: Number(e.target.value) })} /></Field>
          <Field label={`Vertical · ${fmtNum(f.y, 1)} %`}><input type="range" min={-40} max={40} step={0.5} value={f.y} onChange={(e) => setF({ ...f, y: Number(e.target.value) })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function EntryEditor({ entry, onClose }: { entry: PhotoEntry | null; onClose: () => void }) {
  const { run, repo, data, today, units, notify, refresh } = useApp();
  const [current, setCurrent] = useState<PhotoEntry | null>(entry);
  const [date, setDate] = useState(entry?.taken_on ?? today);
  const [waist, setWaist] = useState(entry?.waist_cm?.toString() ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [manualWeight, setManualWeight] = useState(entry?.weight_is_manual ? entry.weight_kg?.toString() ?? "" : "");
  const [useManual, setUseManual] = useState(entry?.weight_is_manual ?? false);
  const [uploading, setUploading] = useState<Pose | null>(null);
  const [framing, setFraming] = useState<PhotoFile | null>(null);

  useEffect(() => { if (current) setCurrent(data.photoEntries.find((e) => e.id === current.id) ?? current); }, [data.photoEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearest = nearestMeasurement(data.measurements, date, 3);
  const nearestFat = nearestBodyFat(data.measurements, date, 3);
  const fields = () => ({
    taken_on: date, waist_cm: waist ? Number(waist) : null, notes: notes || null,
    weight_is_manual: useManual,
    weight_kg: useManual ? (manualWeight ? Number(manualWeight) : null) : nearest?.weight_kg ?? null,
    weight_measurement_id: useManual ? null : nearest?.id ?? null,
  });

  const ensureEntry = async (): Promise<PhotoEntry | null> => {
    if (current) return current;
    const created = await run((r) => r.createPhotoEntry(fields()));
    if (created) setCurrent(created);
    return created ?? null;
  };

  const save = async () => {
    if (current) await run((r) => r.updatePhotoEntry(current.id, fields()), "Registro guardado");
    else await ensureEntry().then((e) => e && notify("Registro creado"));
    onClose();
  };

  const upload = async (pose: Pose, file: File | undefined) => {
    if (!file || !repo) return;
    if (!file.type.startsWith("image/")) { notify("El archivo debe ser una imagen.", "error"); return; }
    setUploading(pose);
    try {
      const e = await ensureEntry();
      if (!e) return;
      await repo.uploadPhoto(e.id, pose, file);
      await refresh();
      notify(`Foto ${POSE_LABEL[pose].toLowerCase()} subida`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    } finally { setUploading(null); }
  };

  return (
    <Modal title={entry ? `Registro del ${fmtDay(entry.taken_on)}` : "Nuevo registro fotográfico"} onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Cerrar</button>
      <button className="btn primary" onClick={save}>Guardar datos</button></>}>
      <div className="stack">
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          <Field label="Fecha"><input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Perímetro de cintura (cm)"><input className="input" type="number" step="0.5" value={waist} onChange={(e) => setWaist(e.target.value)} /></Field>
          <Field label="Peso asociado" hint={useManual ? "Introducido a mano para este registro" : nearest ? `Medición real más cercana: ${fmtDay(nearest.measured_on)} (${nearest.source === "intervals" ? "Feel Fit vía Intervals.icu" : "manual"})${nearest.measured_on !== date ? `, a ${Math.abs(diffDays(nearest.measured_on, date))} día(s)` : ""}` : "No hay mediciones reales a ±3 días"}>
            {useManual
              ? <input className="input" type="number" step="0.1" value={manualWeight} onChange={(e) => setManualWeight(e.target.value)} />
              : <div className="input" style={{ display: "flex", alignItems: "center" }}>{nearest ? fmtWeight(nearest.weight_kg, units) : "Sin datos"}</div>}
          </Field>
          <Field label="Corrección"><label className="row small" style={{ minHeight: 36 }}><input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} />Usar un peso manual</label></Field>
          <Field label="Grasa corporal" hint={nearestFat ? `Medición real más cercana: ${fmtDay(nearestFat.measured_on)}${nearestFat.measured_on !== date ? `, a ${Math.abs(diffDays(nearestFat.measured_on, date))} día(s)` : ""}` : "No hay medición de grasa a ±3 días (no se puede introducir a mano: solo llega sincronizada desde Feel Fit)"}>
            <div className="input" style={{ display: "flex", alignItems: "center" }}>{nearestFat ? `${fmtNum(nearestFat.body_fat_pct, 1)} %` : "Sin datos"}</div>
          </Field>
          <Field label="Notas" full><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: en ayunas, misma luz que la última vez" /></Field>
        </div>
        <div className="photo-grid">
          {POSES.map((pose) => {
            const file = current?.files.find((f) => f.pose === pose);
            return (
              <div key={pose} className="stack" style={{ gap: 6 }}>
                <div className="photo-slot">
                  {file ? <FramedPhoto file={file} alt={`Foto ${POSE_LABEL[pose].toLowerCase()}`} />
                    : <span>{uploading === pose ? "Subiendo…" : `${POSE_LABEL[pose]}\nsin foto`}</span>}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <label className="btn sm" style={{ flex: 1 }}>
                    <Icon name="upload" />{file ? "Sustituir" : POSE_LABEL[pose]}
                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => upload(pose, e.target.files?.[0])} disabled={uploading !== null} />
                  </label>
                  {file && <>
                    <button className="btn sm" onClick={() => setFraming(file)} aria-label="Ajustar encuadre"><Icon name="move" /></button>
                    <button className="btn sm" onClick={() => download(repo, file, date)} aria-label="Descargar original"><Icon name="download" /></button>
                    <button className="btn sm danger" aria-label="Eliminar foto" onClick={() => confirm("¿Eliminar esta foto? Se borrará también el archivo.") && run((r) => r.deletePhoto(file), "Foto eliminada")}><Icon name="trash" /></button>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="tiny muted">Las fotos se guardan en almacenamiento privado; solo tú puedes verlas, mediante enlaces temporales. Se conserva el original y una copia optimizada (sin metadatos de ubicación) para verla en la app.</p>
      </div>
      {framing && <FramingEditor file={framing} onClose={() => setFraming(null)} />}
    </Modal>
  );
}

function Compare({ entries }: { entries: PhotoEntry[] }) {
  const withFiles = entries.filter((e) => e.files.length);
  const sorted = [...withFiles].sort((a, b) => a.taken_on.localeCompare(b.taken_on));
  const [aId, setA] = useState(sorted[0]?.id ?? "");
  const [bId, setB] = useState(sorted[sorted.length - 1]?.id ?? "");
  const [pose, setPose] = useState<Pose>("frontal");
  const [mode, setMode] = useState<"lado" | "deslizador">("lado");
  const [pos, setPos] = useState(50);
  const { units } = useApp();
  if (withFiles.length < 2) return <Empty title="Necesitas al menos dos registros con fotos para comparar" />;
  const A = sorted.find((e) => e.id === aId) ?? sorted[0];
  const B = sorted.find((e) => e.id === bId) ?? sorted[sorted.length - 1];
  const fa = A.files.find((f) => f.pose === pose);
  const fb = B.files.find((f) => f.pose === pose);
  const caption = (e: PhotoEntry) => `${fmtDay(e.taken_on)}${isNum(e.weight_kg) ? ` · ${fmtWeight(e.weight_kg, units)}` : ""}${isNum(e.waist_cm) ? ` · cintura ${fmtNum(e.waist_cm, 1)} cm` : ""}`;
  return (
    <div className="stack">
      <div className="row">
        <select className="input" style={{ width: "auto" }} value={A.id} onChange={(e) => setA(e.target.value)} aria-label="Fecha A">
          {sorted.map((e) => <option key={e.id} value={e.id}>{fmtDayLong(e.taken_on)}</option>)}
        </select>
        <span className="muted">frente a</span>
        <select className="input" style={{ width: "auto" }} value={B.id} onChange={(e) => setB(e.target.value)} aria-label="Fecha B">
          {sorted.map((e) => <option key={e.id} value={e.id}>{fmtDayLong(e.taken_on)}</option>)}
        </select>
        <Segmented label="Pose" value={pose} onChange={setPose} options={POSES.map((p) => ({ value: p, label: POSE_LABEL[p] }))} />
        <Segmented label="Modo" value={mode} onChange={setMode} options={[{ value: "lado", label: "Lado a lado" }, { value: "deslizador", label: "Antes / después" }]} />
      </div>
      {!fa || !fb ? <p className="small muted">Alguna de las dos fechas no tiene foto {POSE_LABEL[pose].toLowerCase()}.</p> : mode === "lado" ? (
        <div className="grid cols-2">
          {[[A, fa], [B, fb]].map(([e, f]) => (
            <div key={(e as PhotoEntry).id} className="stack" style={{ gap: 6 }}>
              <div className="compare" style={{ width: "100%" }}><FramedPhoto file={f as PhotoFile} alt={`Foto del ${fmtDay((e as PhotoEntry).taken_on)}`} /></div>
              <span className="small ink2">{caption(e as PhotoEntry)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="stack" style={{ gap: 8, maxWidth: 520, width: "100%", margin: "0 auto" }}>
          <div className="compare" style={{ width: "100%" }}>
            <div className="layer"><FramedPhoto file={fb} alt={`Después: ${fmtDay(B.taken_on)}`} /></div>
            <div className="layer" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}><FramedPhoto file={fa} alt={`Antes: ${fmtDay(A.taken_on)}`} /></div>
            <div className="divider-line" style={{ left: `calc(${pos}% - 1px)` }} />
            <span className="tag" style={{ left: 8 }}>{fmtDay(A.taken_on)}</span>
            <span className="tag" style={{ right: 8 }}>{fmtDay(B.taken_on)}</span>
          </div>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Deslizador antes y después" />
          <div className="row between small ink2"><span>{caption(A)}</span><span>{caption(B)}</span></div>
        </div>
      )}
      <p className="tiny muted">La app no estima porcentajes de grasa ni kilos de músculo a partir de las fotos. Los cambios entre fechas no permiten atribuir causas por sí solos.</p>
    </div>
  );
}

function Trends({ entries }: { entries: PhotoEntry[] }) {
  const { data, today, theme } = useApp();
  const t = useChartTheme();
  const from = entries.length ? addDays([...entries].sort((a, b) => a.taken_on.localeCompare(b.taken_on))[0].taken_on, -14) : addDays(today, -90);
  const weights = realWeights(data.measurements).filter((m) => m.measured_on >= from).map((m) => ({ x: m.measured_on, peso: m.weight_kg }));
  const fat = realBodyFat(data.measurements).filter((m) => m.measured_on >= from).map((m) => ({ x: m.measured_on, grasa: m.body_fat_pct }));
  const waist = [
    ...data.measurements.filter((m) => isNum(m.waist_cm)).map((m) => ({ x: m.measured_on, cintura: m.waist_cm })),
    ...entries.filter((e) => isNum(e.waist_cm)).map((e) => ({ x: e.taken_on, cintura: e.waist_cm })),
  ].filter((r) => r.x >= from).sort((a, b) => a.x.localeCompare(b.x));
  const weeks: { x: string; horas: number }[] = [];
  for (let w = startOfWeek(from); w <= today; w = addDays(w, 7)) {
    weeks.push({ x: w, horas: Math.round((summarize(inRange(data.activities, w, addDays(w, 6))).timeS / 3600) * 10) / 10 });
  }
  const marks = entries.map((e) => fmtDay(e.taken_on)).join(", ");
  void theme;
  return (
    <div className="grid cols-4">
      <div><h3 style={{ marginBottom: 6 }}>Peso (mediciones reales)</h3>
        {weights.length ? <LineChartBox data={weights} xKey="x" height={160} ariaLabel="Peso" xFormat={(v) => fmtDay(String(v))} yFormat={(v) => fmtNum(v, 1)}
          series={[{ key: "peso", label: "Peso", color: t.ink }]} /> : <p className="small muted">Sin datos</p>}</div>
      <div><h3 style={{ marginBottom: 6 }}>Grasa corporal (%)</h3>
        {fat.length ? <LineChartBox data={fat} xKey="x" height={160} ariaLabel="Grasa corporal" xFormat={(v) => fmtDay(String(v))} yFormat={(v) => `${fmtNum(v, 1)} %`}
          series={[{ key: "grasa", label: "Grasa", color: t.crit }]} /> : <p className="small muted">Sin datos de grasa corporal</p>}</div>
      <div><h3 style={{ marginBottom: 6 }}>Cintura (cm)</h3>
        {waist.length ? <LineChartBox data={waist} xKey="x" height={160} ariaLabel="Cintura" xFormat={(v) => fmtDay(String(v))} yFormat={(v) => fmtNum(v, 1)}
          series={[{ key: "cintura", label: "Cintura", color: t.warn }]} /> : <p className="small muted">Sin datos de cintura</p>}</div>
      <div><h3 style={{ marginBottom: 6 }}>Horas de entrenamiento por semana</h3>
        <StackedBars data={weeks} xKey="x" height={160} ariaLabel="Horas por semana" xFormat={(v) => fmtDay(String(v))} yFormat={(v) => `${fmtNum(v, 1)} h`}
          series={[{ key: "horas", label: "Horas", color: t.info }]} /></div>
      <p className="tiny muted" style={{ gridColumn: "1 / -1" }}>Fechas con fotos: {marks || "ninguna"}. Ver estas series juntas sirve para contextualizar, no para concluir qué ha causado un cambio.</p>
    </div>
  );
}

type CompKey = "muscle_mass_kg" | "skeletal_muscle_pct" | "fat_free_mass_kg" | "visceral_fat" | "subcutaneous_fat_pct"
  | "body_water_pct" | "bone_mass_kg" | "bmr_kcal" | "metabolic_age";
const COMPOSITION: { key: CompKey; label: string; unit: string; digits: number }[] = [
  { key: "muscle_mass_kg", label: "Masa muscular", unit: "kg", digits: 1 },
  { key: "skeletal_muscle_pct", label: "Músculo esquelético", unit: "%", digits: 1 },
  { key: "fat_free_mass_kg", label: "Peso libre de grasa", unit: "kg", digits: 1 },
  { key: "visceral_fat", label: "Grasa visceral", unit: "nivel", digits: 0 },
  { key: "subcutaneous_fat_pct", label: "Grasa subcutánea", unit: "%", digits: 1 },
  { key: "body_water_pct", label: "Agua corporal", unit: "%", digits: 1 },
  { key: "bone_mass_kg", label: "Masa ósea", unit: "kg", digits: 2 },
  { key: "bmr_kcal", label: "Metabolismo basal", unit: "kcal", digits: 0 },
  { key: "metabolic_age", label: "Edad metabólica", unit: "años", digits: 0 },
];

/** Composición estimada por la báscula (Feelfit). Solo días con dato real; nunca se rellena. */
function Composition({ onImport }: { onImport: () => void }) {
  const { data, today } = useApp();
  const t = useChartTheme();
  const [metric, setMetric] = useState<CompKey>("muscle_mass_kg");
  const [range, setRange] = useState<"365" | "1095" | "todo">("1095");
  const withComp = data.measurements.filter((m) => m.source === "feelfit")
    .sort((a, b) => (a.measured_at ?? a.measured_on).localeCompare(b.measured_at ?? b.measured_on));
  if (!withComp.length) {
    return <Empty title="Sin datos de composición" action={<button className="btn primary" onClick={onImport}><Icon name="upload" />Importar export de Feelfit</button>}>
      Importa el export de Feelfit para ver masa muscular, grasa visceral, agua corporal y el resto de estimaciones de la báscula.</Empty>;
  }
  const last = withComp[withComp.length - 1];
  const def = COMPOSITION.find((c) => c.key === metric) ?? COMPOSITION[0];
  const from = range === "todo" ? "0000-00-00" : addDays(today, -Number(range));
  // Una medición por día (la última), igual que las series de peso
  const byDay = new Map<string, number>();
  for (const m of withComp as Measurement[]) { const v = m[metric]; if (typeof v === "number" && m.measured_on >= from) byDay.set(m.measured_on, v); }
  const series = [...byDay.entries()].map(([x, v]) => ({ x, v }));
  return (
    <div className="stack">
      <p className="small ink2">Última medición: <b>{fmtDay(last.measured_on)} {last.measured_on.slice(0, 4)}</b> <OriginBadge origin="estimado" title="Estimación de la báscula por bioimpedancia" /></p>
      <div className="grid stats">
        {COMPOSITION.map((c) => {
          const v = last[c.key];
          return <Stat key={c.key} label={c.label} value={typeof v === "number" ? fmtNum(v, c.digits) : null} unit={c.unit === "nivel" ? undefined : c.unit} />;
        })}
      </div>
      <div className="row">
        <select className="input" style={{ width: "auto" }} value={metric} onChange={(e) => setMetric(e.target.value as CompKey)} aria-label="Métrica">
          {COMPOSITION.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <Segmented label="Periodo" value={range} onChange={setRange} options={[{ value: "365", label: "1 año" }, { value: "1095", label: "3 años" }, { value: "todo", label: "Todo" }]} />
      </div>
      {series.length >= 2 ? (
        <LineChartBox data={series} xKey="x" ariaLabel={def.label} xFormat={(v) => `${fmtDay(String(v))} ${String(v).slice(2, 4)}`}
          yFormat={(v) => `${fmtNum(v, def.digits)}${def.unit === "nivel" ? "" : ` ${def.unit}`}`} series={[{ key: "v", label: def.label, color: t.info }]} />
      ) : <p className="small muted">Hacen falta al menos dos mediciones en el periodo.</p>}
      <p className="chart-note">Son estimaciones de la báscula por bioimpedancia: varían con la hidratación, la hora y la comida. Compara tendencias en condiciones parecidas (p. ej. por la mañana), no valores sueltos. Los días sin medición no se rellenan.</p>
    </div>
  );
}

export default function Physique() {
  const { data, run, repo, units } = useApp();
  const [editing, setEditing] = useState<PhotoEntry | null | "new">(null);
  const [tab, setTab] = useState<"cronologia" | "comparar" | "tendencias" | "composicion">("cronologia");
  const [importing, setImporting] = useState(false);
  const entries = useMemo(() => [...data.photoEntries].sort((a, b) => b.taken_on.localeCompare(a.taken_on)), [data.photoEntries]);
  const fatFor = (date: string) => nearestBodyFat(data.measurements, date, 3);

  return (
    <>
      <PageHead title="Evolución física" sub="Fotografías privadas, peso y cintura en el tiempo"
        actions={<>
          <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" />Importar Feelfit</button>
          <button className="btn primary" onClick={() => setEditing("new")}><Icon name="camera" />Nuevo registro</button>
        </>} />

      <details className="card pad disclosure" style={{ marginBottom: 14 }}>
        <summary><Icon name="chevron" className="ico chev" />Guía para repetir las fotos en las mismas condiciones</summary>
        <div className="grid cols-3" style={{ marginTop: 6 }}>
          {PHOTO_GUIDE.map((g) => <div key={g.title}><h3>{g.title}</h3><p className="small ink2">{g.text}</p></div>)}
        </div>
      </details>

      <div style={{ marginBottom: 14 }}>
        <Segmented label="Sección" value={tab} onChange={setTab} options={[
          { value: "cronologia", label: "Cronología" }, { value: "comparar", label: "Comparar" }, { value: "tendencias", label: "Tendencias" }, { value: "composicion", label: "Composición" }]} />
      </div>

      {tab === "cronologia" && (
        <section className="card">
          {entries.length ? entries.map((e) => (
            <div key={e.id} className="timeline-item">
              <div>
                <div className="num" style={{ fontSize: 16 }}>{fmtDay(e.taken_on)}</div>
                <div className="tiny muted">{e.taken_on.slice(0, 4)}</div>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <div className="thumbs">
                  {POSES.map((p) => { const f = e.files.find((x) => x.pose === p); return f ? <Thumb key={p} file={f} /> : <div key={p} className="thumb" title={`Sin foto ${POSE_LABEL[p].toLowerCase()}`} />; })}
                </div>
                <div className="row small ink2">
                  <span>Peso: {isNum(e.weight_kg) ? fmtWeight(e.weight_kg, units) : "Sin datos"}</span>
                  {isNum(e.weight_kg) && <OriginBadge origin={e.weight_is_manual ? "manual" : "medido"} />}
                  <span>Grasa: {isNum(fatFor(e.taken_on)?.body_fat_pct) ? `${fmtNum(fatFor(e.taken_on)!.body_fat_pct, 1)} %` : "Sin datos"}</span>
                  {isNum(fatFor(e.taken_on)?.body_fat_pct) && <OriginBadge origin="medido" />}
                  <span>Cintura: {isNum(e.waist_cm) ? `${fmtNum(e.waist_cm, 1)} cm` : "Sin datos"}</span>
                  {e.notes && <span className="muted">· {e.notes}</span>}
                </div>
                <div className="row">
                  <button className="btn sm" onClick={() => setEditing(e)}><Icon name="edit" />Editar</button>
                  {e.files.map((f) => <button key={f.id} className="btn sm ghost" onClick={() => download(repo, f, e.taken_on)}><Icon name="download" />{POSE_LABEL[f.pose]}</button>)}
                  <button className="btn sm danger" onClick={() => confirm("¿Eliminar el registro y todas sus fotos? No se puede deshacer.") && run((r) => r.deletePhotoEntry(e), "Registro y fotos eliminados")}><Icon name="trash" />Eliminar</button>
                </div>
              </div>
            </div>
          )) : <Empty title="Aún no hay registros fotográficos" action={<button className="btn primary" onClick={() => setEditing("new")}>Crear el primero</button>}>
            Sube fotos frontal, de perfil y de espalda para seguir tu evolución.</Empty>}
        </section>
      )}
      {tab === "comparar" && <Card title="Comparar dos fechas"><Compare entries={entries} /></Card>}
      {tab === "tendencias" && <Card title="Peso, cintura y entrenamiento"><Trends entries={entries} /></Card>}
      {tab === "composicion" && <Card title="Composición corporal (báscula)"><Composition onImport={() => setImporting(true)} /></Card>}

      <Card title="Comentar cambios visibles" className="" action={<span className="badge">No disponible</span>}>
        <p className="small ink2" style={{ marginTop: 4 }}>Función futura opcional: requiere configurar un proveedor de visión en el servidor. Está desactivada; ninguna foto se envía a servicios externos, y cuando exista solo se usará si la lanzas tú expresamente sobre las fotos que elijas.</p>
      </Card>

      {importing && <FeelfitImportModal onClose={() => setImporting(false)} />}
      {editing && <EntryEditor entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
