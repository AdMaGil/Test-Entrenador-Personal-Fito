import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/icons";
import { PageHead, SyncStatus } from "../components/Layout";
import { Card, Field, Segmented } from "../components/ui";
import { useApp } from "../data/AppData";
import { coachAiEnabled } from "../data/supabaseClient";
import { DOW_LABELS, fmtDateTime } from "../lib/dates";
import { SPORT_LABEL, SPORTS } from "../lib/sports";
import type { Profile, Sport } from "../lib/types";

const EQUIPMENT_SUGGESTIONS = ["Rack", "Barra olímpica", "Polea con agarres individuales", "Discos", "Banco", "Kettlebell", "Mancuernas", "Comba", "Rodillo"];
const TIMEZONES = ["Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon", "Europe/London", "America/Mexico_City", "America/Bogota", "America/Santo_Domingo"];

export default function Settings() {
  const { data, run, mode, session, signOut, tz } = useApp();
  // Material que has indicado tener en casa: se preselecciona, pero no se guarda hasta que confirmes
  const STATED_EQUIPMENT = ["Rack", "Barra olímpica", "Polea con agarres individuales"];
  const withDefaults = (pr: Profile | null): Partial<Profile> =>
    pr ? { ...pr, equipment: pr.equipment?.length ? pr.equipment : STATED_EQUIPMENT } : {};
  const [p, setP] = useState<Partial<Profile>>(withDefaults(data.profile));
  const [newEq, setNewEq] = useState("");
  const [syncFrom, setSyncFrom] = useState(data.connection?.sync_from ?? "");
  useEffect(() => { setP(withDefaults(data.profile)); }, [data.profile]); // eslint-disable-line react-hooks/exhaustive-deps
  const unsavedEquipment = !data.profile?.equipment?.length;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const save = () => run((r) => r.saveProfile(p), "Ajustes guardados");

  const toggleDay = (d: number) => {
    const days = new Set(p.available_days ?? []);
    if (days.has(d)) days.delete(d); else days.add(d);
    set("available_days", [...days].sort());
  };
  const prio = (p.sport_priority?.length ? p.sport_priority : ["hiit", "emtb", "mtb", "run"]) as Sport[];
  const move = (i: number, dir: -1 | 1) => {
    const arr = [...prio];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("sport_priority", arr);
  };
  const eq = p.equipment ?? [];
  const units = p.units ?? { weight: "kg", distance: "km", elevation: "m" };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `adolfo-training-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHead title="Ajustes" actions={<button className="btn primary" onClick={save}>Guardar cambios</button>} />
      <div className="split">
        <div className="stack">
          <Card title="Perfil y preferencias">
            <div className="form-grid">
              <Field label="Nombre"><input className="input" value={p.display_name ?? ""} onChange={(e) => set("display_name", e.target.value || null)} /></Field>
              <Field label="Zona horaria">
                <select className="input" value={p.timezone ?? "Europe/Madrid"} onChange={(e) => set("timezone", e.target.value)}>
                  {TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </Field>
              <Field label="Tema">
                <Segmented label="Tema" value={p.theme ?? "dark"} onChange={(v) => set("theme", v)}
                  options={[{ value: "dark", label: "Oscuro" }, { value: "light", label: "Claro" }, { value: "system", label: "Sistema" }]} />
              </Field>
              <Field label="Unidades">
                <div className="row">
                  <Segmented label="Peso" value={units.weight} onChange={(v) => set("units", { ...units, weight: v })} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]} />
                  <Segmented label="Distancia" value={units.distance} onChange={(v) => set("units", { ...units, distance: v, elevation: v === "mi" ? "ft" : "m" })} options={[{ value: "km", label: "km" }, { value: "mi", label: "mi" }]} />
                </div>
              </Field>
              <Field label="Frecuencia cardiaca máxima (opcional)" hint="Déjala vacía si no la conoces; la app no la inventa.">
                <input className="input" type="number" min={100} max={230} value={p.hr_max_bpm ?? ""} onChange={(e) => set("hr_max_bpm", e.target.value ? Number(e.target.value) : null)} />
              </Field>
              <Field label="Peso objetivo (opcional)">
                <input className="input" type="number" step="0.1" min={30} max={250} value={p.weight_goal_kg ?? ""} onChange={(e) => set("weight_goal_kg", e.target.value ? Number(e.target.value) : null)} />
              </Field>
            </div>
          </Card>

          <Card title="Entrenamiento">
            <div className="form-grid">
              <Field label="Objetivos" full><textarea className="input" value={p.goals ?? ""} onChange={(e) => set("goals", e.target.value || null)} placeholder="Ej.: mejorar la base aeróbica y mantener dos sesiones de fuerza" /></Field>
              <div className="field full">
                <span className="label">Días disponibles</span>
                <div className="row" style={{ gap: 6 }}>
                  {DOW_LABELS.map((d, i) => <button key={d} type="button" className="chip" aria-pressed={(p.available_days ?? []).includes(i + 1)} onClick={() => toggleDay(i + 1)}>{d}</button>)}
                </div>
              </div>
              <Field label="Duración habitual de sesión (min)">
                <input className="input" type="number" min={10} max={600} value={p.session_minutes_default ?? ""} onChange={(e) => set("session_minutes_default", e.target.value ? Number(e.target.value) : null)} />
              </Field>
              <div className="field">
                <span className="label">Prioridad de deportes</span>
                <div className="stack" style={{ gap: 4 }}>
                  {prio.map((s, i) => (
                    <div key={s} className="row between" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "4px 8px" }}>
                      <span className="small">{i + 1}. {SPORT_LABEL[s]}</span>
                      <span className="row nowrap" style={{ gap: 2 }}>
                        <button className="btn ghost sm" onClick={() => move(i, -1)} aria-label={`Subir ${SPORT_LABEL[s]}`} disabled={i === 0}>↑</button>
                        <button className="btn ghost sm" onClick={() => move(i, 1)} aria-label={`Bajar ${SPORT_LABEL[s]}`} disabled={i === prio.length - 1}>↓</button>
                      </span>
                    </div>
                  ))}
                  {SPORTS.filter((s) => s !== "otro" && !prio.includes(s)).map((s) => (
                    <button key={s} className="btn sm" onClick={() => set("sport_priority", [...prio, s])}>Añadir {SPORT_LABEL[s]}</button>
                  ))}
                </div>
              </div>
              <div className="field full">
                <span className="label">Material disponible en casa</span>
                {unsavedEquipment && mode === "real" && <span className="hint">Preseleccionado con el material que indicaste (rack, barra olímpica y polea). Pulsa «Guardar cambios» para confirmarlo.</span>}
                <div className="row" style={{ gap: 6 }}>
                  {[...new Set([...EQUIPMENT_SUGGESTIONS, ...eq])].map((x) => (
                    <button key={x} type="button" className="chip" aria-pressed={eq.includes(x)}
                      onClick={() => set("equipment", eq.includes(x) ? eq.filter((y) => y !== x) : [...eq, x])}>{x}</button>
                  ))}
                </div>
                <div className="row nowrap" style={{ marginTop: 6 }}>
                  <input className="input" value={newEq} onChange={(e) => setNewEq(e.target.value)} placeholder="Otro material…" />
                  <button className="btn sm" onClick={() => { if (newEq.trim()) { set("equipment", [...eq, newEq.trim()]); setNewEq(""); } }}>Añadir</button>
                </div>
              </div>
              <Field label="Limitaciones físicas" full hint="Solo lo que tú indiques; se tiene en cuenta en las propuestas como recordatorio.">
                <textarea className="input" value={p.limitations ?? ""} onChange={(e) => set("limitations", e.target.value || null)} />
              </Field>
              <Field label="Preferencias" full><textarea className="input" value={p.preferences ?? ""} onChange={(e) => set("preferences", e.target.value || null)} placeholder="Ej.: prefiero entrenar por la tarde entre semana" /></Field>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Conexiones">
            <div className="stack" style={{ gap: 10 }}>
              <div className="row between"><b>Intervals.icu</b><SyncStatus /></div>
              {mode === "demo" ? <p className="small muted">En modo demostración no hay conexiones reales.</p> : (
                <>
                  <p className="small ink2">Actividades, series temporales y bienestar (sueño, HRV, FC en reposo, aptitud/fatiga y pesajes de Feel Fit) llegan desde tu cuenta de Intervals.icu. La clave de la API está guardada en el servidor (secreto de GitHub Actions) y nunca llega al navegador. Se sincroniza cada 6 horas, de forma incremental y sin duplicados.</p>
                  {!data.connection || data.connection.status === "desactivada" ? (
                    <div className="stack" style={{ gap: 8 }}>
                      <Field label="Sincronizar desde (opcional)" hint="Vacío = último año"><input className="input" type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} /></Field>
                      <button className="btn primary" onClick={() => run((r) => r.enableConnection(syncFrom || null), "Sincronización activada: los datos llegarán en la próxima ejecución")}>Activar sincronización para mi cuenta</button>
                    </div>
                  ) : (
                    <>
                      <dl className="small" style={{ margin: 0, display: "grid", gridTemplateColumns: "150px 1fr", gap: "4px 10px" }}>
                        <dt className="muted">Estado</dt><dd style={{ margin: 0 }}>{data.connection.status}</dd>
                        <dt className="muted">Última sincronización</dt><dd style={{ margin: 0 }}>{fmtDateTime(data.connection.last_sync_at, tz)}</dd>
                        <dt className="muted">Último éxito</dt><dd style={{ margin: 0 }}>{fmtDateTime(data.connection.last_success_at, tz)}</dd>
                        {data.connection.last_error && <><dt className="muted">Último error</dt><dd style={{ margin: 0, color: "var(--crit)" }}>{data.connection.last_error}</dd></>}
                      </dl>
                      <button className="btn sm" onClick={() => confirm("¿Desactivar la sincronización? Tus datos se conservan.") && run((r) => r.setConnectionStatus("desactivada"), "Sincronización desactivada")}>Desactivar</button>
                    </>
                  )}
                  {data.syncRuns.length > 0 && (
                    <details className="disclosure">
                      <summary><Icon name="chevron" className="ico chev" />Historial de sincronizaciones</summary>
                      <table className="data">
                        <thead><tr><th>Inicio</th><th>Estado</th><th className="n">Act.</th><th className="n">Bienestar</th><th className="n">Pesajes</th></tr></thead>
                        <tbody>{data.syncRuns.map((r) => (
                          <tr key={r.id} title={[...(r.warnings ?? []), r.error ?? ""].filter(Boolean).join("\n")}>
                            <td>{fmtDateTime(r.started_at, tz)}</td><td>{r.status}{r.mode ? ` · ${r.mode}` : ""}</td>
                            <td className="n">{r.activities_upserted}</td><td className="n">{r.wellness_upserted}</td><td className="n">{r.measurements_upserted}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </details>
                  )}
                  <div className="proposal" style={{ borderStyle: "solid" }}>
                    <span className="status warn"><Icon name="alert" />Aviso sobre datos de Garmin</span>
                    <p className="small ink2">El 9 de octubre de 2026 el responsable de Intervals.icu anunció que probablemente tendrá que bloquear el acceso por API a los datos procedentes de Garmin por un cambio en las condiciones de Garmin. A fecha de hoy sigue funcionando y está en conversaciones con Garmin. Si se restringe, la app marcará la sincronización como parcial y podrás <Link to="/actividades">importar archivos FIT</Link> o registrar datos a mano.</p>
                    <a className="small" href="https://forum.intervals.icu/t/api-access-to-intervals-icu/609" target="_blank" rel="noreferrer">Ver el anuncio en el foro de Intervals.icu</a>
                  </div>
                </>
              )}
              <p className="tiny muted">Feel Fit no tiene una conexión propia: sus pesajes llegan a Intervals.icu a través de Health Connect y Health Sync.</p>
            </div>
          </Card>
          <Card title="Asistente con IA">
            <p className="small ink2">{coachAiEnabled ? "Activado: las llamadas se hacen desde la función «coach» del servidor con datos estructurados, nunca con fotografías." : "No configurado. «Mi entrenador» funciona con reglas explícitas y planificación manual. Para activarlo hay que desplegar la función «coach» en Supabase y guardar allí la clave del proveedor."}</p>
          </Card>
          <Card title="Cuenta y datos">
            <div className="stack" style={{ gap: 8 }}>
              {session && <p className="small">Sesión iniciada como <b>{session.user.email}</b></p>}
              <button className="btn" onClick={exportData}><Icon name="download" />Exportar mis datos (JSON)</button>
              {mode === "real" && <button className="btn" onClick={signOut}><Icon name="logout" />Cerrar sesión</button>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
