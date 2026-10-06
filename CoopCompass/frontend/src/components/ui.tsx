import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../api'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-slate-600" data-testid="loading">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-accent-600" aria-hidden />
      {label}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center" data-testid="empty-state">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{children}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null
  const unreachable = e?.unreachable ?? false
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900" data-testid="error-state">
      <p className="font-semibold">{unreachable ? "Can't reach the backend" : 'Something went wrong'}</p>
      <p className="mt-1 text-red-800">
        {unreachable
          ? 'Make sure the CoopCompass API is running on http://localhost:8000, then try again.'
          : message}
      </p>
      {onRetry && <button className="btn mt-3" onClick={onRetry}>Retry</button>}
    </div>
  )
}

type Tone = 'slate' | 'indigo' | 'green' | 'amber' | 'red' | 'teal'
const tones: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  indigo: 'bg-accent-50 text-accent-700 border-accent-100',
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-red-50 text-red-800 border-red-200',
  teal: 'bg-teal-50 text-teal-800 border-teal-200',
}

export function Badge({ children, tone = 'slate', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

const statusTone: Record<string, Tone> = {
  Discovered: 'slate', Saved: 'indigo', Preparing: 'amber', Applied: 'teal', Assessment: 'amber',
  Interview: 'green', Offer: 'green', Rejected: 'red', Withdrawn: 'slate',
}
export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  return <Badge tone={statusTone[status] ?? 'slate'}>{status}</Badge>
}

export function EvidenceChip({ children, kind = 'neutral', title }: { children: ReactNode; kind?: 'strong' | 'partial' | 'gap' | 'neutral'; title?: string }) {
  const map = {
    strong: { icon: '✓', tone: 'green' as Tone, sr: 'strong' },
    partial: { icon: '△', tone: 'amber' as Tone, sr: 'partial' },
    gap: { icon: '✕', tone: 'red' as Tone, sr: 'gap' },
    neutral: { icon: '', tone: 'slate' as Tone, sr: '' },
  }[kind]
  return (
    <Badge tone={map.tone} title={title}>
      {map.icon && <span aria-hidden>{map.icon}</span>}
      {map.sr && <span className="sr-only">{map.sr}:</span>}
      {children}
    </Badge>
  )
}

export function StatCard({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="card px-4 py-3" data-testid={testId}>
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export function Section({ title, children, actions, id }: { title: string; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="card mb-5 p-4" aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold text-slate-900">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close dialog">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function DisclaimerBanner({ text, template }: { text: string; template?: boolean }) {
  return (
    <div data-testid="disclaimer" role="note"
      className={`rounded-md border px-3 py-1.5 text-xs font-semibold tracking-wide ${template ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-accent-100 bg-accent-50 text-accent-700'}`}>
      {text}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} data-testid={`tab-${t.id}`} onClick={() => onChange(t.id)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${value === t.id ? 'border-accent-600 text-accent-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useCopied()
  return (
    <button className="btn btn-sm" onClick={() => { void navigator.clipboard?.writeText(text); setCopied() }}>
      {copied ? 'Copied ✓' : label}
    </button>
  )
}

function useCopied(): [boolean, () => void] {
  const [c, setC] = useState(false)
  const set = useCallback(() => { setC(true); window.setTimeout(() => setC(false), 1500) }, [])
  return [c, set]
}
