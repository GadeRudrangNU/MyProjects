import type { ReactNode } from 'react'
import { tierColor, type Tier } from '../lib/format'

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function Panel({ title, note, children, className = '', right }: { title?: string; note?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`rounded-lg border border-line bg-white ${className}`}>
      {title && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Kpi({ label, value, sub, kind }: { label: string; value: ReactNode; sub?: ReactNode; kind?: 'observed' | 'model' | 'estimate' }) {
  const badge = kind === 'observed' ? 'Observed' : kind === 'model' ? 'Model · held-out' : kind === 'estimate' ? 'Estimate' : null
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted">{label}</div>
        {badge && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{badge}</span>}
      </div>
      <div className="tnum mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  )
}

export function TierBadge({ tier }: { tier: Tier }) {
  const c = tierColor[tier]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium" style={{ color: c, borderColor: `${c}55`, background: `${c}12` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {tier}
    </span>
  )
}

export function Banner({ kind = 'info', children }: { kind?: 'info' | 'warn'; children: ReactNode }) {
  const cls = kind === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-brand/30 bg-brand-soft text-slate-800'
  return <div className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${cls}`}>{children}</div>
}

export function State({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) return <Banner kind="warn">Could not load data: {error}. Is the API running (<code>make api</code>)?</Banner>
  if (loading) return <div className="py-12 text-center text-sm text-muted">Loading…</div>
  return null
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

export const inputCls = 'mt-1 w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand'
