import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { useApi, type Product } from '../api'
import { Banner, Field, inputCls, PageHeader, Panel, State } from '../components/ui'
import { gbp, gbpCompact, num, pct } from '../lib/format'

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }

export default function Products() {
  const [minLines, setMinLines] = useState(300)
  const [size, setSize] = useState<'value_at_risk' | 'credited_value'>('value_at_risk')
  const [sort, setSort] = useState<keyof Product>('value_at_risk')
  const [q, setQ] = useState('')
  const { data, loading, error } = useApi<{ total: number; items: Product[] }>(`/products?limit=1000&min_lines=${minLines}&sort=observed_lines`)
  const items = data?.items ?? []
  const medX = useMemo(() => median(items.map(p => p.observed_lines)), [items])
  const medY = useMemo(() => median(items.map(p => p.observed_rate)), [items])
  const table = useMemo(() => items
    .filter(p => !q || `${p.stock_code} ${p.description}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b[sort] as number) - (a[sort] as number)).slice(0, 25), [items, q, sort])
  const priority = items.filter(p => p.observed_lines >= medX && p.observed_rate >= medY).sort((a, b) => b.credited_value - a.credited_value).slice(0, 5)

  const pts = items.map(p => ({ ...p, x: p.observed_lines, y: p.observed_rate, z: Math.max(p[size], 1) }))
  const Th = ({ k, children }: { k: keyof Product; children: string }) => (
    <th className="cursor-pointer whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-muted hover:text-ink" onClick={() => setSort(k)}>{children}{sort === k ? ' ↓' : ''}</th>
  )

  return (
    <>
      <PageHeader title="Product intelligence" subtitle="Which products create disproportionate credit-note behaviour? Upper-right = high volume and high credit rate: investigate first." />
      <Panel className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Minimum lines sold" hint="Filters out tiny-sample products with noisy rates">
            <select className={inputCls} value={minLines} onChange={e => setMinLines(Number(e.target.value))}>{[100, 300, 500, 1000].map(v => <option key={v} value={v}>{v}</option>)}</select>
          </Field>
          <Field label="Bubble size">
            <select className={inputCls} value={size} onChange={e => setSize(e.target.value as typeof size)}>
              <option value="value_at_risk">Expected value at risk (scored period)</option>
              <option value="credited_value">Observed credited value (all history)</option>
            </select>
          </Field>
          <Field label="Search table"><input className={inputCls} value={q} onChange={e => setQ(e.target.value)} placeholder="Code or description" /></Field>
        </div>
      </Panel>
      {!data ? <State loading={loading} error={error} /> : (
        <>
          <Panel title="Volume vs. credit-note rate" note={`${num(items.length)} products with ≥ ${minLines} lines. Dashed lines = median volume and median rate across these products.`}>
            <ResponsiveContainer width="100%" height={420}>
              <ScatterChart margin={{ left: 4, right: 16, top: 10, bottom: 8 }}>
                <CartesianGrid stroke="#e2e8f0" />
                <XAxis type="number" dataKey="x" scale="log" domain={[minLines, 'dataMax']} allowDataOverflow ticks={[100, 300, 500, 1000, 2000, 5000].filter(t => t >= minLines)} name="Lines sold" tickFormatter={(v: number) => num(v)} tickLine={false} label={{ value: 'Lines sold (log scale)', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#64748b' }} />
                <YAxis type="number" dataKey="y" name="Credit rate" tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} tickLine={false} axisLine={false} width={44} />
                <ZAxis type="number" dataKey="z" range={[30, 600]} />
                <ReferenceLine x={medX} stroke="#94a3b8" strokeDasharray="4 4" />
                <ReferenceLine y={medY} stroke="#94a3b8" strokeDasharray="4 4" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
                  const p = payload?.[0]?.payload as (Product & { z: number }) | undefined
                  if (!p) return null
                  return (
                    <div className="rounded-md border border-line bg-white p-2.5 text-xs shadow-sm">
                      <div className="font-semibold">{p.stock_code} · {p.description}</div>
                      <div className="mt-1 text-muted">Lines sold {num(p.observed_lines)} · credit rate {pct(p.observed_rate, 1)}</div>
                      <div className="text-muted">Credited value {gbp(p.credited_value)} · expected at risk {gbp(p.value_at_risk)}</div>
                    </div>
                  )
                }} />
                <Scatter isAnimationActive={false} data={pts} fill="#3b4cca" fillOpacity={0.45} stroke="#3b4cca" />
              </ScatterChart>
            </ResponsiveContainer>
          </Panel>
          {!!priority.length && (
            <div className="mt-4"><Banner><b>Investigate first</b> (above median volume and rate, ranked by credited value): {priority.map(p => `${p.stock_code} ${p.description ?? ''} (${pct(p.observed_rate, 0)}, ${gbpCompact(p.credited_value)})`).join(' · ')}</Banner></div>
          )}
          <Panel className="mt-4 !p-0" title="Product ranking" note="Observed columns use all labelled history; predicted columns use the scored period (Aug–Dec 2011).">
            <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-line bg-slate-50/60"><tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted">Product</th>
                <Th k="observed_lines">Lines sold</Th><Th k="observed_rate">Credit rate</Th><Th k="credited_value">Value credited</Th><Th k="avg_risk">Avg predicted risk</Th><Th k="value_at_risk">Expected value at risk</Th><Th k="high_risk_lines">High-risk lines</Th>
              </tr></thead>
              <tbody>{table.map(p => (
                <tr key={p.stock_code} className="border-b border-line/70 last:border-0 hover:bg-brand-soft/50">
                  <td className="max-w-[260px] truncate px-3 py-2"><Link className="text-brand" to={`/risk?product=${p.stock_code}`}><span className="text-muted">{p.stock_code}</span> {p.description}</Link></td>
                  <td className="tnum px-3 py-2 text-right">{num(p.observed_lines)}</td><td className="tnum px-3 py-2 text-right">{pct(p.observed_rate)}</td>
                  <td className="tnum px-3 py-2 text-right">{gbp(p.credited_value)}</td><td className="tnum px-3 py-2 text-right">{pct(p.avg_risk)}</td>
                  <td className="tnum px-3 py-2 text-right">{gbp(p.value_at_risk)}</td><td className="tnum px-3 py-2 text-right">{num(p.high_risk_lines)}</td>
                </tr>))}</tbody>
            </table></div>
          </Panel>
        </>
      )}
    </>
  )
}
