import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useApi, type Drivers, type OrderItem, type Product } from '../api'
import Explanation from '../components/Explanation'
import { Banner, PageHeader, Panel, State, TierBadge } from '../components/ui'
import { dateShort, gbp, pct } from '../lib/format'

interface Detail extends OrderItem {
  drivers: Drivers; base_rate: number; expected_credited_lines: number; invoice_line_count: number; credited_value: number
  features: { feature: string; label: string; display_value: string }[]
  invoice_lines: OrderItem[]; product: Product | null
}

export default function OrderDetail() {
  const { id } = useParams()
  const { data: d, loading, error } = useApi<Detail>(`/orders/${id}`)
  if (!d) return <State loading={loading} error={error} />
  return (
    <>
      <Link to="/risk" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-brand"><ArrowLeft size={14} /> Risk explorer</Link>
      <PageHeader title={`${d.description ?? d.stock_code}`}
        subtitle={<>Invoice {d.invoice} · {dateShort(d.invoice_date)} · customer {d.customer_id} · {d.country} · {d.quantity} × {gbp(d.unit_price, 2)} = {gbp(d.line_value, 2)}</>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Prediction explanation">
          <Explanation risk={d.risk} tier={d.tier} drivers={d.drivers} baseRate={d.base_rate} />
        </Panel>
        <div className="space-y-4">
          <Panel title="Outcome">
            {d.outcome == null
              ? <p className="text-sm text-muted">Open — the 30-day window has not closed in the data.</p>
              : d.outcome
                ? <p className="text-sm"><b className="text-risk-high">Credited</b> within 30 days ({gbp(d.credited_value, 2)} credited).</p>
                : <p className="text-sm"><b>No credit note</b> matched within 30 days.</p>}
            <p className="mt-2 text-[11px] text-muted">Expected credited lines on this invoice (sum of line risks): <b>{d.expected_credited_lines.toFixed(2)}</b> of {d.invoice_line_count}</p>
          </Panel>
          {d.product && (
            <Panel title="Product history" note="Observed, full history">
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted">Credit rate</dt><dd className="tnum text-right font-medium">{pct(d.product.observed_rate, 2)}</dd>
                <dt className="text-muted">Lines sold</dt><dd className="tnum text-right">{d.product.observed_lines.toLocaleString()}</dd>
                <dt className="text-muted">Value credited</dt><dd className="tnum text-right">{gbp(d.product.credited_value)}</dd>
              </dl>
            </Panel>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Other lines on this invoice" note="Sorted by risk">
          <table className="w-full text-sm"><tbody>
            {d.invoice_lines.slice(0, 8).map(l => (
              <tr key={l.line_id} className="border-b border-line/70 last:border-0">
                <td className="max-w-[240px] truncate py-1.5 pr-2"><Link className={l.line_id === d.line_id ? 'font-semibold' : 'text-brand'} to={`/orders/${l.line_id}`}>{l.description ?? l.stock_code}</Link></td>
                <td className="tnum py-1.5 text-right">{gbp(l.line_value, 2)}</td>
                <td className="tnum py-1.5 pl-3 text-right">{pct(l.risk)}</td>
                <td className="py-1.5 pl-3"><TierBadge tier={l.tier} /></td>
              </tr>
            ))}
          </tbody></table>
          {d.invoice_lines.length > 8 && <p className="mt-2 text-xs text-muted">+ {d.invoice_lines.length - 8} more lines</p>}
        </Panel>
        <Panel title="Model inputs for this line" note="All features are computed from information available at purchase time">
          <div className="grid max-h-80 grid-cols-1 gap-x-6 overflow-y-auto text-sm sm:grid-cols-2">
            {d.features.map(f => (
              <div key={f.feature} className="flex justify-between border-b border-line/70 py-1.5"><span className="text-muted">{f.label}</span><span className="tnum font-medium">{f.display_value}</span></div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="mt-4"><Banner>Credit notes include returns, cancellations and billing corrections; the dataset cannot tell them apart.</Banner></div>
    </>
  )
}
