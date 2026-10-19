import { useEffect, type ReactNode } from "react";
import { MISSING } from "../lib/format";
import { SPORT_LABEL, SPORT_SHORT } from "../lib/sports";
import type { PlanCategory } from "../lib/types";
import { Icon, type IconName } from "./icons";
import { useApp } from "../data/AppData";

// Tonos del icono-chip (cuadrado redondeado con icono de color) que aparece
// en cabeceras de tarjeta y estadísticas, replicando el patrón recurrente
// de las mockups. Se apoya en variables de tema ya existentes + --violet.
export type Tone = "accent" | "ok" | "warn" | "crit" | "info" | "violet";

export function IconChip({ icon, tone = "info" }: { icon: IconName; tone?: Tone }) {
  return (
    <span className={`icon-chip tone-${tone}`} aria-hidden="true">
      <Icon name={icon} />
    </span>
  );
}

export function Card({ title, icon, tone, action, children, className = "", pad = false }: {
  title?: ReactNode; icon?: IconName; tone?: Tone; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${pad ? "pad" : ""} ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div className="card-head-title">
            {icon && <IconChip icon={icon} tone={tone} />}
            {typeof title === "string" ? <h2>{title}</h2> : title}
          </div>
          {action}
        </div>
      )}
      {title || action ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function Stat({ label, value, unit, foot, badge, icon, tone }: {
  label: ReactNode; value: string | number | null | undefined; unit?: string; foot?: ReactNode; badge?: ReactNode;
  icon?: IconName; tone?: Tone;
}) {
  const missing = value === null || value === undefined || value === MISSING || value === "";
  return (
    <div className="card stat">
      <div className="stat-label">
        <span className="stat-label-text">
          {icon && <IconChip icon={icon} tone={tone} />}
          <span>{label}</span>
        </span>
        {badge}
      </div>
      {missing ? (
        <div className="stat-value missing">{MISSING}</div>
      ) : (
        <div className="stat-value">{value}{unit && <span className="unit">{unit}</span>}</div>
      )}
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export function SportChip({ cat, short = false }: { cat: PlanCategory; short?: boolean }) {
  return (
    <span className="chip sport">
      <span className="dot" style={{ background: `var(--${cat})` }} />
      {short ? SPORT_SHORT[cat] : SPORT_LABEL[cat]}
    </span>
  );
}

const ORIGIN_TEXT = {
  medido: "Medido",
  estimado: "Estimado",
  manual: "Registrado manualmente",
  demo: "Demostración",
} as const;

export function OriginBadge({ origin, title }: { origin: keyof typeof ORIGIN_TEXT; title?: string }) {
  const { mode } = useApp();
  // En modo demostración ningún dato se presenta como medido o real
  const o = mode === "demo" ? "demo" : origin;
  return <span className={`badge ${o}`} title={title}>{ORIGIN_TEXT[o]}</span>;
}

export function StatusLine({ kind, children }: { kind: "ok" | "warn" | "crit" | "info"; children: ReactNode }) {
  const icon: IconName = kind === "ok" ? "check" : kind === "info" ? "info" : "alert";
  return <span className={`status ${kind}`}><Icon name={icon} />{children}</span>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="t">{title}</div>
      {children && <div className="small">{children}</div>}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, variant = "pills" }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
  /** "pills" (por defecto): grupo compacto con relleno al elegir. "tabs": fila de pestañas subrayadas. */
  variant?: "pills" | "tabs";
}) {
  return (
    <div className={`segmented ${variant === "tabs" ? "tabs" : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide = false }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, full = false }: { label: string; hint?: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Scale({ value, onChange, labels, name }: {
  value: number | null; onChange: (v: number) => void; labels: string[]; name: string;
}) {
  return (
    <div className="scale" role="radiogroup" aria-label={name}>
      {labels.map((l, i) => (
        <button key={l} type="button" role="radio" aria-checked={value === i + 1} aria-pressed={value === i + 1}
          onClick={() => onChange(i + 1)}>{l}</button>
      ))}
    </div>
  );
}

export function Loading({ text = "Cargando…" }: { text?: string }) {
  return <div className="empty"><div className="t">{text}</div></div>;
}
