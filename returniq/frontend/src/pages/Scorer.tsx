import { useState } from 'react'
import { api, type Drivers } from '../api'
import Explanation from '../components/Explanation'
import { Banner, Field, inputCls, PageHeader, Panel } from '../components/ui'
import type { Tier } from '../lib/format'

interface Pred { risk: number; tier: Tier; drivers: Drivers; base_rate: number; known_customer: boolean; known_product: boolean; model: string }

export default function Scorer() {
  const [f, setF] = useState({ stock_code: '22423', quantity: '12', unit_price: '9.95', customer_id: '', country: 'United Kingdom', order_lines: '10', order_value: '' })
  const [res, setRes] = useState<Pred | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      setRes(await api<Pred>('/predict', { method: 'POST', body: JSON.stringify({
        stock_code: f.stock_code, quantity: Number(f.quantity), unit_price: Number(f.unit_price),
        customer_id: f.customer_id ? Number(f.customer_id) : null, country: f.country,
        order_lines: Number(f.order_lines) || 1, order_value: f.order_value ? Number(f.order_value) : null,
      }) }))
    } catch (x) { setErr(String((x as Error).message)); setRes(null) } finally { setBusy(false) }
  }

  return (
    <>
      <PageHeader title="Order scorer" subtitle="Score a hypothetical order line as if it were placed at the end of the dataset (2011-12-09). Customer and product history are looked up from the data; unknown IDs are treated as new." />
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-2" title="Order line">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Product code" hint="Catalogue code, e.g. 22423 (REGENCY CAKESTAND 3 TIER)"><input className={inputCls} value={f.stock_code} onChange={set('stock_code')} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity"><input className={inputCls} type="number" min="1" step="1" value={f.quantity} onChange={set('quantity')} required /></Field>
              <Field label="Unit price (£)"><input className={inputCls} type="number" min="0.01" step="0.01" value={f.unit_price} onChange={set('unit_price')} required /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Customer ID" hint="Optional"><input className={inputCls} inputMode="numeric" value={f.customer_id} onChange={e => setF(s => ({ ...s, customer_id: e.target.value.replace(/\D/g, '') }))} /></Field>
              <Field label="Country"><input className={inputCls} value={f.country} onChange={set('country')} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Products in order"><input className={inputCls} type="number" min="1" value={f.order_lines} onChange={set('order_lines')} /></Field>
              <Field label="Total order value (£)" hint="Optional"><input className={inputCls} type="number" min="0" step="0.01" value={f.order_value} onChange={set('order_value')} /></Field>
            </div>
            <button disabled={busy} className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{busy ? 'Scoring…' : 'Score order line'}</button>
          </form>
        </Panel>
        <Panel className="lg:col-span-3" title="Result">
          {err && <Banner kind="warn">{err}</Banner>}
          {!res && !err && <p className="py-10 text-center text-sm text-muted">Enter an order line and score it.</p>}
          {res && (
            <>
              <Explanation risk={res.risk} tier={res.tier} drivers={res.drivers} baseRate={res.base_rate} />
              <p className="mt-3 text-[11px] text-muted">
                {res.known_customer ? 'Known customer history used.' : 'Customer not in data → treated as a new customer.'}{' '}
                {res.known_product ? 'Known product history used.' : 'Product not in data → no product history.'} Model: {res.model}.
              </p>
            </>
          )}
        </Panel>
      </div>
    </>
  )
}
