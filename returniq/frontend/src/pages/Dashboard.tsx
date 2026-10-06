import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi, type Product } from '../api'
import { Banner, Kpi, PageHeader, Panel, State } from '../components/ui'
import { dateShort, gbp, gbpCompact, num, pct } from '../lib/format'

interface Metrics {
  observed: any
  model: { selected_model: string; roc_auc: number; pr_auc: number; precision: number; recall: number; f1: number; test_samples: number; base_rate: number }
  top_k: { top_fraction: number; precision: number; recall: number; lift: number }[]
  tiers: Record<string, { share_of_lines: number; observed_rate: number; share_of_all_positives: number }>
  trend: { week: string; observed_rate: number | null; avg_risk: number | null }[]
  risk_distribution: { bin: string; lines: number; observed_rate: number | null; test_lines: number }[]
}
interface Segment { dimension: string; segment: string; lines: number; observed_lines: number; observed_rate: number | null; avg_risk: number | null; value_at_risk: number }

const SEG_ORDER = ['New (first order)', 'Early (1-4 prior orders)', 'Established (5-19)', 'Loyal (20+)', '< £1', '£1-3', '£3-8', '£8+',
  '1 unit', '2-6 units', '7-24 units', '25+ units', 'United Kingdom', 'International', '1-5 products', '6-20 products', '21-50 products', '51+ products']

const C = { brand: '#3b4cca', teal: '#0f766e', grid: '#e2e8f0', bar: '#6b78d6' }

export default function Dashboard() {
  const m = useApi<Metrics>('/metrics')
  const prods = useApi<{ items: Product[] }>('/products?sort=value_at_risk&limit=10&min_lines=200')
  const segs = useApi<Segment[]>('/segments')
  const [dim, setDim] = useState('Customer maturity')
  const dims = useMemo(() => Array.from(new Set((segs.data ?? []).map(s => s.dimension))), [segs.data])

  if (!m.data) return <State loading={m.loading} error={m.error} />
  const { observed: o, model, top_k, tiers, trend, risk_distribution } = m.data
  const top10 = top_k.find(t => t.top_fraction === 0.1)!
  const sc = o.scored
  const segRows = (segs.data ?? []).filter(s => s.dimension === dim)
    .sort((a, b) => SEG_ORDER.indexOf(a.segment) - SEG_ORDER.indexOf(b.segment))

  return (
    <>
      <PageHeader title="Executive dashboard"
        subtitle={<>Which purchase lines are likely to end in a customer credit note within 30 days, and what is it worth? Data: UCI Online Retail II, {dateShort(o.period[0])} → {dateShort(o.period[1])}.</>} />

      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Observed dataset metrics</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi kind="observed" label="Transactions analysed" value={num(o.purchase_lines_modelled)} sub={`${num(o.invoices_total)} invoices · ${num(o.customers)} customers`} />
        <Kpi kind="observed" label="Credit-note rate (30 d)" value={pct(o.line_credit_rate_30d, 2)} sub={`${num(o.credited_lines_30d)} of ${num(o.observable_lines)} lines · ${pct(o.order_credit_rate_30d)} of orders`} />
        <Kpi kind="observed" label="Value credited (30 d)" value={gbpCompact(o.credited_value_30d)} sub={`${pct(o.value_credit_rate_30d, 2)} of £${(o.revenue_observable / 1e6).toFixed(1)}M revenue`} />
        <Kpi kind="observed" label="Average order value" value={gbp(o.avg_order_value)} sub={`${pct(o.repeat_customer_rate, 0)} of customers ordered 2+ times`} />
      </div>

      <div className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wide text-muted">Model on held-out period · {dateShort(sc.test_period[0])} → {dateShort(sc.test_period[1])}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi kind="model" label="ROC-AUC" value={model.roc_auc.toFixed(3)} sub={`PR-AUC ${model.pr_auc.toFixed(3)} vs ${model.base_rate.toFixed(3)} base rate`} />
        <Kpi kind="model" label="Precision in top 10% risk" value={pct(top10.precision)} sub={`${top10.lift.toFixed(1)}× lift · captures ${pct(top10.recall, 0)} of credits`} />
        <Kpi kind="estimate" label="Value at risk · open window" value={gbpCompact(sc.value_at_risk_pending)} sub={`${num(sc.high_risk_lines_pending)} high-risk lines · ${dateShort(sc.pending_period[0])} → ${dateShort(sc.pending_period[1])}`} />
        <Kpi kind="model" label="High-risk line rate" value={pct(sc.high_risk_rate_test)} sub={`High tier: ${pct(tiers.High.observed_rate)} credited vs ${pct(tiers.Low.observed_rate)} in Low`} />
      </div>
      <div className="mt-3"><Banner>
        Value at risk = Σ (predicted risk × line value × avg. credited share of a line, {pct(o.avg_credit_fraction_of_line, 0)}) for lines whose 30-day window is still open. It is an expectation, not a measured loss.
        On the held-out period the same formula expected {gbpCompact(sc.value_at_risk_test_expected)} against {gbpCompact(sc.credited_value_test_observed)} actually credited.
      </Banner></div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Credit-note risk over time" note="Weekly observed credit rate (history) and mean predicted risk (scored period, from Aug 2011). Recent weeks have no outcome yet.">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="week" tickFormatter={(w: string) => new Date(w).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })} minTickGap={36} tickLine={false} axisLine={{ stroke: C.grid }} />
              <YAxis tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} tickLine={false} axisLine={false} width={48} />
              <Tooltip formatter={(v) => pct(Number(v), 2)} labelFormatter={(l) => `Week of ${l}`} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line isAnimationActive={false} name="Observed credit rate" dataKey="observed_rate" stroke={C.brand} strokeWidth={2} dot={false} connectNulls={false} />
              <Line isAnimationActive={false} name="Mean predicted risk" dataKey="avg_risk" stroke={C.teal} strokeWidth={2} dot={false} strokeDasharray="5 3" connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel className="lg:col-span-2" title="Observed credit rate by predicted-risk bin" note="Held-out period only. A rising bar = the score separates risk.">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={risk_distribution} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="bin" tickLine={false} axisLine={{ stroke: C.grid }} interval={0} fontSize={10} />
              <YAxis tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} tickLine={false} axisLine={false} width={40} />
              <Tooltip formatter={(v) => pct(Number(v), 2)} labelFormatter={(l) => `Predicted risk ${l}`} />
              <Bar isAnimationActive={false} dataKey="observed_rate" name="Observed credit rate" fill={C.bar} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-1 text-[11px] text-muted">Lines per bin: {risk_distribution.map(d => `${d.bin} ${num(d.lines)}`).join(' · ')}</div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Products with most value at risk" note="Open window, volume ≥ 200 historic lines. Click through in Product intelligence."
          right={<Link to="/products" className="text-xs font-medium text-brand">All products →</Link>}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={(prods.data?.items ?? []).map(p => ({ ...p, name: `${p.stock_code} ${(p.description ?? '').slice(0, 22)}` }))} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid stroke={C.grid} horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => gbpCompact(v)} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={170} tickLine={false} axisLine={false} fontSize={10} />
              <Tooltip formatter={(v) => gbp(Number(v))} />
              <Bar isAnimationActive={false} dataKey="value_at_risk" name="Expected value at risk (scored period)" fill={C.brand} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Segments" note="Observed credit rate (full labelled history) — compare groups, mind the volume."
          right={<select className="rounded-md border border-line px-2 py-1 text-xs" value={dim} onChange={e => setDim(e.target.value)}>{dims.map(d => <option key={d}>{d}</option>)}</select>}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={segRows} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="segment" tickLine={false} axisLine={{ stroke: C.grid }} interval={0} fontSize={10} />
              <YAxis tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`} tickLine={false} axisLine={false} width={44} />
              <Tooltip formatter={(v) => pct(Number(v), 2)} />
              <Bar isAnimationActive={false} dataKey="observed_rate" name="Observed credit rate" radius={[4, 4, 0, 0]}>
                {segRows.map((_, i) => <Cell key={i} fill={C.bar} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="text-[11px] text-muted">{segRows.map(s => `${s.segment}: ${num(s.observed_lines)} lines`).join(' · ')}</div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="North-star metric" note="30-Day Retained Purchase Rate">
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Observed proxy (this dataset)</div>
              <div className="tnum mt-1 flex gap-6">
                <div><div className="text-xl font-semibold">{pct(o.retained_purchase_rate_30d_orders, 2)}</div><div className="text-xs text-muted">of orders had no credited line</div></div>
                <div><div className="text-xl font-semibold">{pct(o.retained_purchase_rate_30d_lines, 2)}</div><div className="text-xs text-muted">of lines retained</div></div>
              </div>
            </div>
            <div className="text-xs text-muted">Computed from heuristically linked credit notes (see limitations), so it is a proxy for the production metric.</div>
          </div>
        </Panel>
        <Panel title="Proposed production KPIs" note="Not measured here — would require live instrumentation.">
          <ul className="space-y-1.5 text-xs text-slate-700">
            <li><b>Primary:</b> 30-day retained purchase rate in treated vs. control orders (confirmed returns/cancellations, order-level).</li>
            <li><b>Guardrails:</b> checkout conversion, checkout completion, average order value, cancellation rate.</li>
            <li><b>Operational:</b> intervention coverage, precision among top-risk orders, cost per prevented return.</li>
            <li><b>Unavailable in this data:</b> exchange rate and cancellation reasons (no such fields).</li>
          </ul>
        </Panel>
      </div>
    </>
  )
}
