import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useApi, type OrderItem } from '../api'
import { Banner, Field, inputCls, PageHeader, Panel, State, TierBadge } from '../components/ui'
import { dateShort, gbp, num, pct } from '../lib/format'

const PAGE = 25

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

export default function RiskExplorer() {
  const nav = useNavigate()
  const filters = useApi<{ countries: string[] }>('/filters')
  const [tiers, setTiers] = useState<string[]>(() => (new URLSearchParams(window.location.search).get('product') ? [] : ['High']))
  const [q, setQ] = useState('')
  const [params] = useSearchParams()
  const [product, setProduct] = useState(params.get('product') ?? '')
  const [customer, setCustomer] = useState('')
  const [country, setCountry] = useState('')
  const [minV, setMinV] = useState('')
  const [maxV, setMaxV] = useState('')
  const [split, setSplit] = useState('')
  const [sort, setSort] = useState('risk')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)

  const text = useDebounced({ q, product, customer, minV, maxV })
  const path = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE), sort, order })
    if (tiers.length && tiers.length < 3) p.set('tier', tiers.join(','))
    if (text.q) p.set('q', text.q)
    if (text.product) p.set('stock_code', text.product)
    if (text.customer) p.set('customer_id', text.customer)
    if (country) p.set('country', country)
    if (text.minV) p.set('min_value', text.minV)
    if (text.maxV) p.set('max_value', text.maxV)
    if (split) p.set('split', split)
    return `/orders?${p}`
  }, [tiers, text, country, split, sort, order, page])
  const { data, error, loading } = useApi<{ total: number; items: OrderItem[] }>(path)

  useEffect(() => setPage(0), [tiers, text, country, split, sort, order])
  const toggleTier = (t: string) => setTiers(x => (x.includes(t) ? x.filter(i => i !== t) : [...x, t]))
  const sortBy = (k: string) => { if (sort === k) setOrder(o => (o === 'desc' ? 'asc' : 'desc')); else { setSort(k); setOrder('desc') } }
  const Th = ({ k, children, right }: { k?: string; children: string; right?: boolean }) => (
    <th className={`whitespace-nowrap px-3 py-2 text-xs font-medium text-muted ${right ? 'text-right' : 'text-left'} ${k ? 'cursor-pointer select-none hover:text-ink' : ''}`} onClick={k ? () => sortBy(k) : undefined}>
      <span className="inline-flex items-center gap-1">{children}{k && sort === k && (order === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}</span>
    </th>
  )
  const lastPage = Math.max(0, Math.ceil((data?.total ?? 0) / PAGE) - 1)

  return (
    <>
      <PageHeader title="Risk explorer" subtitle="Scored order lines (one product on one invoice) from the held-out period and the still-open window. Click a row for the full explanation." />
      <Panel className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Risk tier">
            <div className="mt-1.5 flex gap-1.5">
              {['Low', 'Medium', 'High'].map(t => (
                <button key={t} onClick={() => toggleTier(t)} className={`rounded-md border px-2.5 py-1 text-xs ${tiers.includes(t) ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line text-slate-600'}`}>{t}</button>
              ))}
            </div>
          </Field>
          <Field label="Search"><input className={inputCls} placeholder="Invoice, product name or code" value={q} onChange={e => setQ(e.target.value)} /></Field>
          <Field label="Product code"><input className={inputCls} placeholder="e.g. 22423" value={product} onChange={e => setProduct(e.target.value)} /></Field>
          <Field label="Customer ID"><input className={inputCls} inputMode="numeric" placeholder="e.g. 12748" value={customer} onChange={e => setCustomer(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Country">
            <select className={inputCls} value={country} onChange={e => setCountry(e.target.value)}>
              <option value="">All countries</option>
              {filters.data?.countries.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Line value (£)">
            <div className="flex gap-2"><input className={inputCls} placeholder="min" value={minV} onChange={e => setMinV(e.target.value)} /><input className={inputCls} placeholder="max" value={maxV} onChange={e => setMaxV(e.target.value)} /></div>
          </Field>
          <Field label="Window">
            <select className={inputCls} value={split} onChange={e => setSplit(e.target.value)}>
              <option value="">Held-out + open</option><option value="test">Held-out (outcome known)</option><option value="pending">Open (outcome pending)</option>
            </select>
          </Field>
        </div>
      </Panel>

      <State loading={loading && !data} error={error} />
      {data && (
        <Panel className="!p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs text-muted">
            <span className="tnum">{num(data.total)} order lines</span>
            <span>Risk = calibrated probability of a credit note within 30 days</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b border-line bg-slate-50/60"><tr>
                <Th k="invoice_date">Date</Th><Th>Invoice</Th><Th>Customer</Th><Th>Product</Th><Th k="line_value" right>Line value</Th>
                <Th k="risk" right>Risk</Th><Th>Tier</Th><Th>Top risk drivers</Th><Th>Outcome</Th>
              </tr></thead>
              <tbody>
                {data.items.map(r => (
                  <tr key={r.line_id} onClick={() => nav(`/orders/${r.line_id}`)} className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-brand-soft/50">
                    <td className="tnum whitespace-nowrap px-3 py-2 text-slate-600">{dateShort(r.invoice_date)}</td>
                    <td className="tnum px-3 py-2">{r.invoice}</td>
                    <td className="tnum px-3 py-2">{r.customer_id}</td>
                    <td className="max-w-[220px] truncate px-3 py-2" title={r.description ?? ''}><span className="text-muted">{r.stock_code}</span> {r.description}</td>
                    <td className="tnum px-3 py-2 text-right">{gbp(r.line_value, 2)}</td>
                    <td className="tnum px-3 py-2 text-right font-medium">{pct(r.risk)}</td>
                    <td className="px-3 py-2"><TierBadge tier={r.tier} /></td>
                    <td className="max-w-[260px] px-3 py-2 text-xs text-slate-600">{r.top_drivers?.map(d => `${d.label} (${d.display_value})`).slice(0, 2).join(' · ') || '—'}</td>
                    <td className="px-3 py-2 text-xs">{r.outcome == null ? <span className="text-muted">Open</span> : r.outcome ? <span className="font-medium text-risk-high">Credited</span> : <span className="text-muted">Kept</span>}</td>
                  </tr>
                ))}
                {!data.items.length && <tr><td colSpan={9} className="px-3 py-10 text-center text-muted">No order lines match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 text-xs">
            <span className="text-muted">Page {page + 1} of {lastPage + 1}</span>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded-md border border-line px-3 py-1 disabled:opacity-40">Previous</button>
              <button disabled={page >= lastPage} onClick={() => setPage(p => p + 1)} className="rounded-md border border-line px-3 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
        </Panel>
      )}
      <div className="mt-3"><Banner>“Credited” means a credit note was matched to this line within 30 days — a proxy for a return or cancellation, not proof of one.</Banner></div>
    </>
  )
}
