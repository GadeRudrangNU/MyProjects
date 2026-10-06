import { useEffect, useState } from 'react'

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json()
}

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (path == null) return
    let live = true
    setLoading(true)
    api<T>(path)
      .then(d => live && (setData(d), setError(null)))
      .catch(e => live && setError(String(e.message ?? e)))
      .finally(() => live && setLoading(false))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps])
  return { data, error, loading }
}

export interface Driver { feature: string; label: string; display_value: string; value: number; shap: number }
export interface Drivers { increasing: Driver[]; decreasing: Driver[] }
export interface OrderItem {
  line_id: number; invoice: string; invoice_date: string; customer_id: number; stock_code: string
  description: string | null; country: string; quantity: number; unit_price: number; line_value: number
  risk: number; tier: 'Low' | 'Medium' | 'High'; split: 'test' | 'pending'; outcome: number | null
  top_drivers?: { label: string; display_value: string; shap: number }[]
}
export interface Product {
  stock_code: string; description: string | null; observed_lines: number; credited_lines: number
  observed_rate: number; revenue: number; credited_value: number; units: number; scored_lines: number
  avg_risk: number; high_risk_lines: number; value_at_risk: number
}
