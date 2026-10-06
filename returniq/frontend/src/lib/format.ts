export const pct = (v: number | null | undefined, d = 1) =>
  v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(d)}%`

export const num = (v: number | null | undefined, d = 0) =>
  v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d })

export const gbp = (v: number | null | undefined, d = 0) =>
  v == null || Number.isNaN(v) ? '—' : `${v < 0 ? '−' : ''}£${Math.abs(v).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d })}`

export const compact = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0)

export const gbpCompact = (v: number) => `${v < 0 ? '−' : ''}£${compact(Math.abs(v))}`

export const dateShort = (s: string | null | undefined) => (s ? s.slice(0, 10) : '—')

export type Tier = 'Low' | 'Medium' | 'High'
export const tierColor: Record<Tier, string> = { High: '#c2410c', Medium: '#b7791f', Low: '#2f7d5b' }
