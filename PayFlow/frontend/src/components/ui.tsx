import { X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { ApiError } from "../api";
import { failureLabel } from "../format";
import type { FraudDecision, Payment } from "../types";

type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  captured: "ok",
  authorized: "info",
  pending: "warn",
  refunded: "neutral",
  failed: "bad",
  open: "warn",
  approved: "ok",
  rejected: "bad",
  delivered: "ok",
  dead: "bad",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label ?? status}</Badge>;
}

/** Shows the payment's state, with the reason when it did not go through. */
export function PaymentStatus({ payment }: { payment: Payment }) {
  if (payment.status === "pending" && payment.fraud_decision === "review") return <Badge tone="warn">In review</Badge>;
  if (payment.status === "failed") return <Badge tone="bad">{failureLabel(payment.failure_reason) || "Failed"}</Badge>;
  if (payment.status === "captured" && payment.refunded_amount > 0) return <Badge tone="ok">Partly refunded</Badge>;
  return <StatusBadge status={payment.status} label={payment.status[0].toUpperCase() + payment.status.slice(1)} />;
}

export function RiskMeter({ score, decision }: { score: number | null; decision: FraudDecision }) {
  if (score === null) return <span className="muted">n/a</span>;
  return (
    <span className="row" style={{ gap: 8 }} title={`risk ${score.toFixed(2)} (${decision})`}>
      <span className="meter">
        <i className={decision === "block" ? "block" : decision === "review" ? "review" : ""} style={{ width: `${Math.max(4, score * 100)}%` }} />
      </span>
      <span className="num muted" style={{ width: 34 }}>{score.toFixed(2)}</span>
    </span>
  );
}

export function Card({ title, sub, action, children, flush }: { title?: string; sub?: string; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={flush ? "" : "card-body"} style={flush ? { paddingTop: 12 } : undefined}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, note, icon }: { label: string; value: ReactNode; note?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="label">{icon}{label}</div>
      <div className="value num">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, subtitle, onClose, children }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <div className="overlay" style={{ placeItems: "stretch" }} onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div>
            <div style={{ fontSize: 17, fontWeight: 650 }}>{title}</div>
            {subtitle && <div className="muted" style={{ marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

// ---- toasts -----------------------------------------------------------------------------
type Toast = { id: number; tone: "ok" | "bad" | "info"; text: string };
const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.fields) {
      const first = Object.entries(e.fields)[0];
      if (first) return `${first[0]}: ${Array.isArray(first[1]) ? first[1].join(" ") : String(first[1])}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function ErrorBanner({ error }: { error: Error | undefined }) {
  if (!error) return null;
  return <div className="alert bad" role="alert">{errorText(error)}</div>;
}
