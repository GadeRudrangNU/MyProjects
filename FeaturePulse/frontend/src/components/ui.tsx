import { ReactNode, useEffect, useState } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  )
}

export function Panel({ title, children, right, className = '' }: { title?: string; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`bg-white border border-slate-200 rounded-lg ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900'
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold tnum mt-1 ${color}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
  )
}

const SEV: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
}
export function SeverityBadge({ level, overridden }: { level: string; overridden?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium capitalize ${SEV[level] ?? SEV.low}`}>
      {level}
      {overridden && <span title="PM override">*</span>}
    </span>
  )
}

const SENT: Record<string, string> = {
  negative: 'bg-red-50 text-red-700 border-red-200',
  positive: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
}
export function SentimentBadge({ label }: { label: string | null }) {
  if (!label) return <span className="text-slate-400">—</span>
  return <span className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-medium capitalize ${SENT[label]}`}>{label}</span>
}

export function Trend({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <span className="text-slate-400">—</span>
  const cls = pct >= 25 ? 'text-red-700 font-semibold' : pct <= -25 ? 'text-emerald-700' : 'text-slate-600'
  return (
    <span className={`tnum ${cls}`}>
      {pct > 0 ? '+' : ''}
      {pct.toFixed(0)}%
    </span>
  )
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-block rounded bg-slate-100 text-slate-600 text-xs px-1.5 py-0.5 mr-1 mb-1">{children}</span>
}

export function Loading({ error }: { error?: string | null }) {
  if (error) return <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-3">Error: {error}</div>
  return <div className="text-sm text-slate-500 p-6">Loading…</div>
}

export function useFetch<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    loader()
      .then(d => {
        if (alive) {
          setData(d)
          setError(null)
        }
      })
      .catch(e => alive && setError(String(e.message ?? e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, error, reload: () => setTick(t => t + 1), setData }
}

export function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString())
