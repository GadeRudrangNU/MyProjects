export const HIGH_MATCH = 70

export type ScoreTone = 'high' | 'mid' | 'low' | 'none'

export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '–'
  return String(Math.round(score))
}

export function scoreTone(score: number | null | undefined): ScoreTone {
  if (score === null || score === undefined || Number.isNaN(score)) return 'none'
  if (score >= HIGH_MATCH) return 'high'
  if (score >= 50) return 'mid'
  return 'low'
}

export const toneLabel: Record<ScoreTone, string> = {
  high: 'Strong match', mid: 'Moderate match', low: 'Weak match', none: 'Not scored',
}

function parseDate(iso: string): Date {
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = parseDate(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null
  const d = parseDate(iso)
  if (Number.isNaN(d.getTime())) return null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((end - start) / 86400000)
}

export function deadlineText(iso: string | null | undefined, now: Date = new Date()): string {
  const n = daysUntil(iso, now)
  if (n === null) return 'No deadline'
  if (n < 0) return `Passed ${-n}d ago`
  if (n === 0) return 'Due today'
  return `${n}d left`
}

export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—'
  if (min < 1) return '<1 min'
  if (min < 90) return `${Math.round(min)} min`
  return `${(min / 60).toFixed(1)} h`
}

export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—'
  const pct = rate <= 1 ? rate * 100 : rate
  return `${Math.round(pct * 10) / 10}%`
}

export function normaliseWeights<T extends object>(w: T): T {
  const entries = Object.entries(w) as [string, number][]
  const total = entries.reduce((a, [, v]) => a + v, 0)
  const out: Record<string, number> = {}
  for (const [k, v] of entries) out[k] = total > 0 ? Math.round((v / total) * 1000) / 10 : 0
  return out as T
}

export function titleCaseKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
