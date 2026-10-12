import { useState } from "react";
import { useApp } from "../data/AppData";
import { supabase, supabaseConfigured } from "../data/supabaseClient";
import { Field } from "../components/ui";

export default function Login() {
  const { startDemo } = useApp();
  const [mode, setMode] = useState<"entrar" | "crear">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMsg(null);
    const res = mode === "entrar"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
    setBusy(false);
    if (res.error) {
      setMsg({ kind: "error", text: res.error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : res.error.message });
    } else if (mode === "crear" && !res.data.session) {
      setMsg({ kind: "ok", text: "Cuenta creada. Revisa tu correo para confirmarla y después inicia sesión." });
    }
  };

  return (
    <div className="login">
      <div className="card pad stack">
        <div className="row nowrap" style={{ gap: 12 }}>
          <img src="./icon.svg" alt="" width={40} height={40} />
          <div>
            <h1>Adolfo Training</h1>
            <p className="muted small">Entrenamiento, salud y evolución física</p>
          </div>
        </div>

        {supabaseConfigured ? (
          <form className="stack" onSubmit={submit}>
            <Field label="Correo electrónico">
              <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Contraseña" hint={mode === "crear" ? "Mínimo 8 caracteres." : undefined}>
              <input className="input" type="password" autoComplete={mode === "entrar" ? "current-password" : "new-password"} minLength={8}
                required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {msg && <p className={`small`} style={{ color: msg.kind === "error" ? "var(--crit)" : "var(--ok)" }} role="alert">{msg.text}</p>}
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Un momento…" : mode === "entrar" ? "Iniciar sesión" : "Crear cuenta"}</button>
            <button className="btn ghost" type="button" onClick={() => setMode(mode === "entrar" ? "crear" : "entrar")}>
              {mode === "entrar" ? "Crear una cuenta nueva" : "Ya tengo cuenta"}
            </button>
          </form>
        ) : (
          <p className="small ink2">Esta instalación no tiene configurada la conexión con Supabase, así que no hay datos reales disponibles.</p>
        )}

        <div className="divider" style={{ height: 1, background: "var(--line)" }} />
        <div className="stack" style={{ gap: 6 }}>
          <button className="btn" onClick={startDemo}>Explorar con datos de demostración</button>
          <p className="tiny muted">Los datos de demostración son ficticios, viven solo en esta pestaña y nunca se guardan ni se mezclan con datos reales.</p>
        </div>
      </div>
    </div>
  );
}
