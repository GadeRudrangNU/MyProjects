import { useEffect, useState } from 'react'
import { api, useApi } from '../api'
import { Banner, Field, inputCls, PageHeader, Panel } from '../components/ui'
import { num, pct } from '../lib/format'

interface SS { n_per_arm: number; p_control: number; p_treatment: number; absolute_difference: number; weeks_to_enrol?: number }

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid gap-1 border-b border-line/70 py-2.5 text-sm last:border-0 sm:grid-cols-4"><div className="font-medium text-slate-700">{k}</div><div className="text-slate-600 sm:col-span-3">{children}</div></div>
)

export default function Experiment() {
  const m = useApi<any>('/metrics')
  const high = m.data?.tiers?.High
  const sc = m.data?.observed?.scored
  const days = sc ? (new Date(sc.test_period[1]).getTime() - new Date(sc.test_period[0]).getTime()) / 86400000 : 0
  const weekly = sc && days ? (sc.test_lines * sc.high_risk_rate_test) / (days / 7) : 0

  const [baseline, setBaseline] = useState<number | null>(null)
  const [mde, setMde] = useState(15)
  const [alpha, setAlpha] = useState(0.05)
  const [power, setPower] = useState(0.8)
  const [res, setRes] = useState<SS | null>(null)
  useEffect(() => { if (baseline == null && high) setBaseline(Number((high.observed_rate * 100).toFixed(2))) }, [high, baseline])
  useEffect(() => {
    if (baseline == null || !(baseline > 0)) return
    api<SS>('/experiment/sample-size', { method: 'POST', body: JSON.stringify({ baseline: baseline / 100, relative_reduction: mde / 100, alpha, power, eligible_orders_per_week: weekly || null }) })
      .then(setRes).catch(() => setRes(null))
  }, [baseline, mde, alpha, power, weekly])

  return (
    <>
      <PageHeader title="Experiment design" subtitle="A proposed A/B test for a return-reduction intervention targeted by ReturnIQ risk scores." />
      <div className="mb-4"><Banner kind="warn"><b>Design artifact — not a result.</b> This experiment has not been run. No treatment effect, lift or revenue impact is claimed anywhere in this project.</Banner></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Design">
          <Row k="Hypothesis">For orders ReturnIQ scores as high-risk, adding a targeted intervention (e.g. clearer product information or a purchase confirmation step) lowers the 30-day credit-note rate without reducing checkout conversion or order value.</Row>
          <Row k="Unit & exposure">Randomise at the <b>order</b> (or customer, to avoid contamination) level. Eligible: orders with ≥1 line in the High tier at checkout time, scored by the frozen model. Eligible orders are randomised 50/50.</Row>
          <Row k="Control">Normal purchase experience.</Row>
          <Row k="Treatment">Normal experience + ReturnIQ-triggered intervention for the flagged lines.</Row>
          <Row k="Primary metric">30-day retained purchase rate = purchases not returned/cancelled within 30 days ÷ eligible purchases. Needs confirmed return/cancellation events in production (this dataset only has credit notes).</Row>
          <Row k="Guardrails">Checkout conversion · checkout completion · average order value · cancellation rate (pre-shipment). Each has a pre-registered non-inferiority margin.</Row>
          <Row k="Decision rule">Ship if the primary metric improves with p&lt;α (two-sided) <i>and</i> every guardrail stays within its margin. If the primary improves but a guardrail breaks, iterate on the intervention. Otherwise stop. Run the full planned duration — no peeking-based stopping.</Row>
          <Row k="Risks">Model drift (re-validate scores monthly), novelty effects, selection effects of the 30-day window (early reads are censored), interference between customers.</Row>
        </Panel>
        <Panel title="Sample-size calculator" note="Two-sided two-proportion z-test. Defaults come from this dataset's observed High-tier rate; the effect size is your assumption.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Baseline credit rate in eligible (%)" hint={high ? `Observed in High tier (held-out): ${pct(high.observed_rate, 2)}` : ''}><input className={inputCls} type="number" step="0.1" value={baseline ?? ''} onChange={e => setBaseline(Number(e.target.value))} /></Field>
            <Field label="Minimum detectable reduction (relative, %)" hint="Assumption — what you'd need to see to care."><input className={inputCls} type="number" min="1" max="90" value={mde} onChange={e => setMde(Number(e.target.value))} /></Field>
            <Field label="Significance (α)"><select className={inputCls} value={alpha} onChange={e => setAlpha(Number(e.target.value))}>{[0.01, 0.05, 0.1].map(v => <option key={v}>{v}</option>)}</select></Field>
            <Field label="Power"><select className={inputCls} value={power} onChange={e => setPower(Number(e.target.value))}>{[0.7, 0.8, 0.9].map(v => <option key={v}>{v}</option>)}</select></Field>
          </div>
          {res && (
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
              <div><div className="text-xs text-muted">Per arm</div><div className="tnum text-xl font-semibold">{num(res.n_per_arm)}</div></div>
              <div><div className="text-xs text-muted">Total</div><div className="tnum text-xl font-semibold">{num(res.n_per_arm * 2)}</div></div>
              <div><div className="text-xs text-muted">Weeks to enrol*</div><div className="tnum text-xl font-semibold">{res.weeks_to_enrol ? res.weeks_to_enrol.toFixed(1) : '—'}</div></div>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            n = (z<sub>1−α/2</sub>√(2p̄q̄) + z<sub>power</sub>√(p₁q₁+p₂q₂))² / (p₁−p₂)².
            *Uses about {num(weekly)} High-tier lines per week observed in the held-out period as the eligible flow (line-level approximation for order-level eligibility) at this retailer's scale.
          </p>
        </Panel>
      </div>
    </>
  )
}
