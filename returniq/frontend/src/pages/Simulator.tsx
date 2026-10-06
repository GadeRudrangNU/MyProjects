import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { Banner, Kpi, PageHeader, Panel } from '../components/ui'
import { gbp, gbpCompact, num, pct } from '../lib/format'

interface Sim {
  label: string
  result: {
    targeted_lines: number; targeted_orders: number; targeted_customers: number; targeted_value: number
    expected_credits_in_targeted: number; returns_prevented: number; revenue_preserved: number; margin_preserved: number
    handling_cost_saved: number; intervention_cost: number; conversion_margin_lost: number; net_benefit: number
    roi: number | null; breakeven_effectiveness: number | null; risk_cutoff: number | null; population_observed_rate?: number
    backtest?: { observed_credited_lines_in_targeted: number; observed_precision: number; share_of_all_observed_credited_value_captured: number; observed_credited_value_in_targeted: number }
  }
  curve: { top_percent: number; net_benefit: number }[]
}

const PRESETS: Record<string, { effectiveness: number; cost: number; conv: number; note: string }> = {
  'Improved product information': { effectiveness: 0.10, cost: 0.05, conv: 0.005, note: 'Cheap, broad; modest effect.' },
  'Purchase confirmation step': { effectiveness: 0.12, cost: 0.10, conv: 0.03, note: 'Adds friction → conversion guardrail matters.' },
  'High-risk order review (manual)': { effectiveness: 0.30, cost: 3.00, conv: 0.01, note: 'Expensive per order; only viable on the top slice.' },
  'Targeted customer messaging': { effectiveness: 0.08, cost: 0.15, conv: 0.002, note: 'Low friction, low effect.' },
  'Product quality investigation': { effectiveness: 0.20, cost: 1.00, conv: 0.0, note: 'Fix at the source for flagged products (cost is a proxy).' },
}

export default function Simulator() {
  const [scope, setScope] = useState<'backtest' | 'open'>('backtest')
  const [top, setTop] = useState(5)
  const [preset, setPreset] = useState('Targeted customer messaging')
  const [eff, setEff] = useState(8)
  const [cost, setCost] = useState(0.15)
  const [margin, setMargin] = useState(30)
  const [conv, setConv] = useState(0.2)
  const [handling, setHandling] = useState(0)
  const [sim, setSim] = useState<Sim | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      api<Sim>('/simulate-intervention', { method: 'POST', body: JSON.stringify({
        scope, top_percent: top, effectiveness: eff / 100, cost_per_order: cost, margin: margin / 100,
        conversion_loss: conv / 100, handling_cost_per_credit: handling }) })
        .then(s => { setSim(s); setErr(null) }).catch(e => setErr(String(e.message)))
    }, 200)
    return () => clearTimeout(t)
  }, [scope, top, eff, cost, margin, conv, handling])

  const applyPreset = (k: string) => { setPreset(k); const p = PRESETS[k]; setEff(p.effectiveness * 100); setCost(p.cost); setConv(p.conv * 100) }
  const r = sim?.result
  const Slider = ({ label, value, set, min, max, step, suffix = '' }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; suffix?: string }) => (
    <label className="block text-xs">
      <div className="flex justify-between"><span className="font-medium text-slate-700">{label}</span><span className="tnum font-medium">{value}{suffix}</span></div>
      <input type="range" className="mt-1 w-full accent-[#3b4cca]" min={min} max={max} step={step} value={value} onChange={e => set(Number(e.target.value))} />
    </label>
  )

  return (
    <>
      <PageHeader title="Intervention simulator" subtitle="Decide who to target and whether the economics hold up. Every outcome below is a projection from the assumptions you set." />
      <div className="mb-4"><Banner kind="warn"><b>SIMULATED.</b> Effectiveness, cost, margin and conversion loss are assumptions — the dataset contains none of them and no intervention was ever run. Risk scores, order values and (in backtest) observed credits are the only data-derived inputs.</Banner></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Assumptions" className="lg:col-span-1">
          <div className="space-y-4">
            <label className="block text-xs"><span className="font-medium text-slate-700">Intervention archetype</span>
              <select className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm" value={preset} onChange={e => applyPreset(e.target.value)}>
                {Object.keys(PRESETS).map(k => <option key={k}>{k}</option>)}
              </select>
              <span className="mt-0.5 block text-[11px] text-muted">{PRESETS[preset].note} Starting values are placeholders.</span>
            </label>
            <label className="block text-xs"><span className="font-medium text-slate-700">Population</span>
              <select className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm" value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
                <option value="backtest">Backtest: held-out Aug–Nov 2011 (outcomes known)</option>
                <option value="open">Open window: Nov–Dec 2011 (outcomes pending)</option>
              </select>
            </label>
            <Slider label="Target the top X% riskiest lines" value={top} set={setTop} min={1} max={50} step={1} suffix="%" />
            <Slider label="Effectiveness (share of credits prevented)" value={eff} set={setEff} min={0} max={60} step={1} suffix="%" />
            <Slider label="Cost per targeted order (£)" value={cost} set={setCost} min={0} max={10} step={0.05} />
            <Slider label="Gross margin on retained sales" value={margin} set={setMargin} min={0} max={80} step={1} suffix="%" />
            <Slider label="Conversion loss on targeted orders" value={conv} set={setConv} min={0} max={10} step={0.1} suffix="%" />
            <Slider label="Handling cost avoided per credit (£)" value={handling} set={setHandling} min={0} max={20} step={0.5} />
          </div>
        </Panel>
        <div className="space-y-4 lg:col-span-2">
          {err && <Banner kind="warn">{err}</Banner>}
          {r && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Kpi label="Orders targeted" value={num(r.targeted_orders)} sub={`${num(r.targeted_lines)} lines · ${num(r.targeted_customers)} customers`} />
                <Kpi kind="estimate" label="Returns prevented" value={num(r.returns_prevented, 1)} sub={`of ~${num(r.expected_credits_in_targeted, 0)} expected credits in targeted lines`} />
                <Kpi kind="estimate" label="Value preserved (margin)" value={gbp(r.margin_preserved + r.handling_cost_saved)} sub={`${gbp(r.revenue_preserved)} revenue retained`} />
                <Kpi kind="estimate" label="Intervention cost" value={gbp(r.intervention_cost)} sub={`+ ${gbp(r.conversion_margin_lost)} margin lost to friction`} />
                <Kpi kind="estimate" label="Net benefit" value={<span className={r.net_benefit >= 0 ? 'text-risk-low' : 'text-risk-high'}>{gbp(r.net_benefit)}</span>} sub={r.roi == null ? '' : `ROI ${(r.roi * 100).toFixed(0)}%`} />
                <Kpi label="Break-even effectiveness" value={r.breakeven_effectiveness == null ? '—' : pct(r.breakeven_effectiveness, 0)} sub="effect needed for net benefit = 0" />
              </div>
              {r.backtest && (
                <Panel title="Backtest reality check (observed, not simulated)" note="What actually happened to the lines the model would have targeted.">
                  <div className="grid gap-4 text-sm sm:grid-cols-3">
                    <div><div className="text-xs text-muted">Targeted lines actually credited</div><div className="tnum text-lg font-semibold">{num(r.backtest.observed_credited_lines_in_targeted)}</div><div className="text-xs text-muted">{pct(r.backtest.observed_precision)} precision (vs {pct(r.population_observed_rate)} across all lines)</div></div>
                    <div><div className="text-xs text-muted">Credited value in targeted set</div><div className="tnum text-lg font-semibold">{gbpCompact(r.backtest.observed_credited_value_in_targeted)}</div></div>
                    <div><div className="text-xs text-muted">Share of all credited value captured</div><div className="tnum text-lg font-semibold">{pct(r.backtest.share_of_all_observed_credited_value_captured, 0)}</div></div>
                  </div>
                </Panel>
              )}
              <Panel title="Net benefit vs. how many lines you target" note="Same assumptions; the bar for your current selection is highlighted. Shows the point where broader targeting stops paying.">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={sim!.curve} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="top_percent" tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                    <YAxis tickFormatter={(v: number) => gbpCompact(v)} tickLine={false} axisLine={false} width={56} />
                    <ReferenceLine y={0} stroke="#64748b" />
                    <Tooltip formatter={(v) => gbp(Number(v))} labelFormatter={(l) => `Top ${l}% targeted`} />
                    <Bar isAnimationActive={false} dataKey="net_benefit" name="Net benefit" radius={[3, 3, 0, 0]}>
                      {sim!.curve.map((c, i) => <Cell key={i} fill={c.top_percent === top ? '#3b4cca' : '#b8bff0'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </>
          )}
        </div>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted">
        Method: expected credits = Σ calibrated risk over targeted lines. Revenue preserved = Σ(risk × line value) × average credited share of a credited line × effectiveness. Net benefit = margin preserved + handling saved − (targeted orders × cost per order) − margin lost to conversion friction on lines that would otherwise have been kept.
      </p>
    </>
  )
}
