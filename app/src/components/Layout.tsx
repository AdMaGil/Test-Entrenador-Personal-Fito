import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { coachAiEnabled } from "../data/supabaseClient";
import { useApp } from "../data/AppData";
import { fmtDateTime, relativeFromNow } from "../lib/dates";
import { Icon, type IconName } from "./icons";
import { StatusLine } from "./ui";

// Nombres pensados para no solaparse: "Entrenamiento" (carga, fuerza, sesiones) vs. "Físico" (peso, grasa, fotos).
const NAV: { to: string; label: string; icon: IconName; mobile?: boolean }[] = [
  { to: "/hoy", label: "Hoy", icon: "today", mobile: true },
  { to: "/calendario", label: "Calendario", icon: "calendar", mobile: true },
  { to: "/actividades", label: "Actividades", icon: "list", mobile: true },
  { to: "/evolucion", label: "Entrenamiento", icon: "chart" },
  { to: "/salud", label: "Salud y recuperación", icon: "heart", mobile: true },
  { to: "/fisico", label: "Físico", icon: "camera" },
  { to: "/entrenador", label: "Mi entrenador", icon: "coach" },
  { to: "/ajustes", label: "Ajustes", icon: "settings" },
];

export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const { mode, data, tz } = useApp();
  if (mode === "demo") return <StatusLine kind="warn">Datos de demostración · sin conexión real</StatusLine>;
  const c = data.connection;
  if (!c) return <StatusLine kind="info">Intervals.icu sin conectar</StatusLine>;
  if (c.status === "desactivada") return <StatusLine kind="info">Sincronización desactivada</StatusLine>;
  if (!c.last_sync_at) return <StatusLine kind="info">Pendiente de la primera sincronización</StatusLine>;
  const when = compact ? relativeFromNow(c.last_sync_at) : `${fmtDateTime(c.last_sync_at, tz)} (${relativeFromNow(c.last_sync_at)})`;
  if (c.status === "error") return <StatusLine kind="crit">Error de sincronización · {when}</StatusLine>;
  if (c.status === "parcial") return <StatusLine kind="warn">Sincronización parcial · {when}</StatusLine>;
  return <StatusLine kind="ok">Intervals.icu · {when}</StatusLine>;
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { mode, exitDemo, toast, session, data } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);
  const loc = useLocation();
  const mobileNav = NAV.filter((n) => n.mobile);
  const moreActive = !mobileNav.some((n) => loc.pathname.startsWith(n.to));

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Navegación principal">
        <div className="brand">
          <div className="brand-mark"><img src="./icon.svg" alt="" width={22} height={22} /></div>
          <div>
            <div className="brand-name">Adolfo Training</div>
            <div className="brand-sub">Entrenamiento y salud</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon name={n.icon} />{n.label}
              {n.to === "/entrenador" && !coachAiEnabled && <span className="tiny muted" style={{ marginLeft: "auto" }}>reglas</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot stack" style={{ gap: 6 }}>
          <SyncStatus compact />
          {mode === "real" && <span className="tiny">{data.profile?.display_name || session?.user.email}</span>}
        </div>
      </aside>

      <div className="main">
        {mode === "demo" && (
          <div className="banner demo" role="status">
            <Icon name="alert" />
            <div className="grow"><strong>Datos de demostración.</strong> Son ficticios, viven solo en esta pestaña y nunca se guardan ni se mezclan con tus datos reales.</div>
            <button className="btn sm" onClick={exitDemo}>Salir</button>
          </div>
        )}
        <main className="content">{children}</main>
      </div>

      <nav className="bottomnav" aria-label="Navegación">
        {mobileNav.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "active" : "")} onClick={() => setMoreOpen(false)}>
            <Icon name={n.icon} /><span>{n.label === "Salud y recuperación" ? "Salud" : n.label}</span>
          </NavLink>
        ))}
        <button className={moreActive ? "active" : ""} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <Icon name="more" /><span>Más</span>
        </button>
      </nav>

      <div className={`more-sheet ${moreOpen ? "open" : ""}`} onClick={() => setMoreOpen(false)}>
        <div className="panel" role="dialog" aria-label="Más secciones" onClick={(e) => e.stopPropagation()}>
          <nav className="nav">
            {NAV.filter((n) => !n.mobile).map((n) => (
              <NavLink key={n.to} to={n.to} onClick={() => setMoreOpen(false)} className={({ isActive }) => (isActive ? "active" : "")}>
                <Icon name={n.icon} />{n.label}
                {n.to === "/entrenador" && !coachAiEnabled && <span className="tiny muted" style={{ marginLeft: "auto" }}>reglas</span>}
              </NavLink>
            ))}
          </nav>
          <div style={{ padding: "10px 10px 0" }}><SyncStatus /></div>
        </div>
      </div>

      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </div>
  );
}
