import { useMemo, useState } from "react";
import { useApp } from "../data/AppData";
import { fmtDayLong } from "../lib/dates";
import { parseFeelfit, planImport, toMeasurementInsert, type FeelfitParse } from "../lib/feelfit";
import { fmtNum } from "../lib/format";
import { readXlsx, readZip } from "../lib/xlsx";
import { Icon } from "./icons";
import { Modal } from "./ui";

/**
 * Importa el export de Feelfit (.xlsx o el .zip tal como llega por correo).
 * Se lee en el navegador; nada se guarda hasta pulsar «Importar».
 */
export function FeelfitImportModal({ onClose }: { onClose: () => void }) {
  const { data, repo, refresh, notify, tz, mode } = useApp();
  const [parse, setParse] = useState<FeelfitParse | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [include, setInclude] = useState<Set<string>>(new Set());

  const plan = useMemo(() => (parse ? planImport(parse, data.measurements, include) : null), [parse, data.measurements, include]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null); setParse(null); setReading(true); setFileName(f.name); setInclude(new Set());
    try {
      let buf = await f.arrayBuffer();
      if (/\.zip$/i.test(f.name)) {
        // El correo de Feelfit trae un .zip con el .xlsx dentro
        const entries = await readZip(buf);
        const xlsx = [...entries.entries()].find(([n]) => /\.xlsx$/i.test(n));
        if (!xlsx) throw new Error("El .zip no contiene ningún Excel (.xlsx).");
        buf = xlsx[1].slice().buffer;
      }
      setParse(parseFeelfit(await readXlsx(buf)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally { setReading(false); }
  };

  const save = async () => {
    if (!repo || !plan || saving) return;
    setSaving(true); setError(null);
    try {
      const n = await repo.importMeasurements(plan.toInsert.map((r) => toMeasurementInsert(r, tz)));
      await refresh();
      notify(`${n} medición(es) de Feelfit importadas`);
      onClose();
    } catch (e) {
      // El archivo y el plan se conservan para reintentar; reimportar no duplica
      setError(`No se ha podido importar: ${e instanceof Error ? e.message : String(e)}. Puedes reintentar sin riesgo de duplicados.`);
    } finally { setSaving(false); }
  };

  const toggle = (id: string) => setInclude((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Modal title="Importar export de Feelfit" onClose={() => !saving && onClose()} footer={<>
      <button className="btn" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn primary" onClick={save} disabled={!plan || !plan.toInsert.length || saving} aria-busy={saving}>
        {saving ? "Importando…" : plan ? `Importar ${plan.toInsert.length} mediciones` : "Importar"}
      </button>
    </>}>
      <div className="stack" style={{ gap: 12 }}>
        <p className="small ink2">Sube el archivo que te envía Feelfit (.zip o .xlsx). Se lee en tu navegador y solo se guardan las mediciones de peso y composición; el resto del export se ignora.</p>
        <input className="input" type="file" accept=".xlsx,.zip" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Archivo de Feelfit" />
        {reading && <p className="small muted">Leyendo {fileName}…</p>}
        {mode === "demo" && <p className="tiny muted">Modo demostración: lo importado vive solo en esta pestaña.</p>}
        {error && <p className="status crit" role="alert"><Icon name="alert" />{error}</p>}
        {parse && plan && (
          <>
            <table className="data">
              <tbody>
                <tr><td>Periodo</td><td>{plan.from && plan.to ? `${fmtDayLong(plan.from)} – ${fmtDayLong(plan.to)}` : "Sin datos"}</td></tr>
                <tr><td>Nuevas a importar</td><td className="num"><b>{plan.toInsert.length}</b></td></tr>
                <tr><td>Ya importadas antes</td><td className="num">{plan.alreadyImported}</td></tr>
                <tr><td>Repetidas en el archivo (se importan una vez)</td><td className="num">{parse.duplicatesInFile}</td></tr>
                <tr><td>Coinciden con pesadas de Intervals.icu</td><td className="num">{plan.unifiedWithIntervals} <span className="muted small">· se cuentan una vez (Feelfit)</span></td></tr>
                {parse.invalid.length > 0 && <tr><td>Filas no válidas (no se importan)</td><td className="num">{parse.invalid.length}</td></tr>}
              </tbody>
            </table>
            {parse.outliers.length > 0 && (
              <div className="proposal" style={{ borderColor: "var(--warn)" }}>
                <span className="status warn"><Icon name="alert" />Pesadas atípicas: excluidas salvo que las marques</span>
                <p className="small ink2">Se alejan 5 kg o más de las pesadas cercanas (¿otra persona en la báscula?).</p>
                {parse.outliers.map((o) => (
                  <label key={o.row.external_id} className="row small" style={{ minHeight: 40, flexWrap: "nowrap" }}>
                    <input type="checkbox" checked={include.has(o.row.external_id)} onChange={() => toggle(o.row.external_id)} />
                    {fmtDayLong(o.row.measured_on)} {o.row.local_time.slice(11, 16)} · {fmtNum(o.row.weight_kg, 2)} kg (cercanas: {fmtNum(o.neighborsMedianKg, 1)} kg) — importar igualmente
                  </label>
                ))}
              </div>
            )}
            <details className="disclosure">
              <summary><Icon name="chevron" className="ico chev" />Qué se guarda</summary>
              <p className="small ink2" style={{ paddingBottom: 10 }}>
                Peso (medido), % de grasa, IMC, masa muscular, músculo esquelético, proteína, metabolismo basal, peso libre de grasa,
                grasa subcutánea, grasa visceral, agua corporal, masa ósea y edad metabólica. Salvo el peso, son estimaciones de la báscula.
                Los ceros se guardan como «sin dato». No se importan: {parse.ignoredColumns.join(", ")}.
              </p>
            </details>
          </>
        )}
      </div>
    </Modal>
  );
}
