export async function api<T = any>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = opts
  const init: RequestInit = { ...rest }
  if (json !== undefined) {
    init.method = init.method ?? 'POST'
    init.headers = { 'Content-Type': 'application/json', ...(init.headers || {}) }
    init.body = JSON.stringify(json)
  }
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    let msg = res.statusText
    try {
      const b = await res.json()
      msg = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail)
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json()
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const WEIGHT_KEYS = ['frequency', 'severity', 'trend', 'customer_impact', 'sentiment', 'strategic_fit'] as const
export type WeightKey = (typeof WEIGHT_KEYS)[number]
export const WEIGHT_LABELS: Record<WeightKey, string> = {
  frequency: 'Frequency',
  severity: 'Severity',
  trend: 'Trend',
  customer_impact: 'Customer impact',
  sentiment: 'Sentiment impact',
  strategic_fit: 'Strategic fit',
}
export const BUCKET_LABELS: Record<string, string> = {
  now: 'Now',
  next: 'Next',
  later: 'Later',
  investigate: 'Investigate',
  wont_do: "Won't Do",
}
