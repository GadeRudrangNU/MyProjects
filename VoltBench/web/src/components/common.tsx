import type { ReactNode } from 'react'
import type { Status, Verdict } from '../types'

export function Loading({ what = 'data' }: { what?: string }) {
  return <div className="state">Loading {what}…</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state muted">{children}</div>
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message =
    typeof error === 'object' && error && 'status' in error
      ? `Request failed (${String((error as { status: unknown }).status)})`
      : 'Something went wrong'
  return (
    <div className="state error" role="alert">
      {message}
      {retry && (
        <button className="btn small" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge status-${status.toLowerCase()}`}>{status}</span>
}

export function VerdictCell({ verdict, onClick, label }: { verdict?: Verdict; onClick?: () => void; label?: string }) {
  if (!verdict) return <span className="cell none">–</span>
  return (
    <button className={`cell verdict-${verdict.toLowerCase()}`} onClick={onClick} title={label} data-verdict={verdict}>
      {verdict}
    </button>
  )
}

export function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`tile ${tone ?? ''}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {hint && <div className="tile-hint">{hint}</div>}
    </div>
  )
}

export const pct = (v: number | null | undefined, digits = 1) => (v == null ? 'n/a' : `${(v * 100).toFixed(digits)}%`)

export function ago(ms: number) {
  if (!ms) return 'never'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`
}
