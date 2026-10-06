import type { Drivers, Driver } from '../api'
import { pct, type Tier, tierColor } from '../lib/format'
import { TierBadge } from './ui'

function DriverList({ items, sign, max }: { items: Driver[]; sign: 1 | -1; max: number }) {
  const color = sign > 0 ? '#c2410c' : '#2f7d5b'
  if (!items.length) return <div className="text-xs text-muted">None of note.</div>
  return (
    <ul className="space-y-2.5">
      {items.map(d => (
        <li key={d.feature}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{d.label}: <span className="font-medium">{d.display_value}</span></span>
            <span className="tnum text-xs text-muted">{d.shap > 0 ? '+' : '−'}{(Math.abs(d.shap) * 100).toFixed(2)} pts</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100">
            <div className="h-1.5 rounded-full" style={{ width: `${Math.max(4, (Math.abs(d.shap) / max) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function Explanation({ risk, tier, drivers, baseRate }: { risk: number; tier: Tier; drivers: Drivers; baseRate: number }) {
  const max = Math.max(1e-9, ...[...drivers.increasing, ...drivers.decreasing].map(d => Math.abs(d.shap)))
  const c = tierColor[tier]
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <div className="text-xs font-medium text-muted">Credit-note risk (30 days)</div>
          <div className="tnum mt-1 text-5xl font-semibold tracking-tight" style={{ color: c }}>{pct(risk)}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted">Risk tier</div>
          <div className="mt-2 text-base"><TierBadge tier={tier} /></div>
        </div>
        <div className="text-xs text-muted">
          Portfolio base rate: <span className="tnum font-medium text-slate-700">{pct(baseRate, 2)}</span><br />
          This line is <span className="tnum font-medium text-slate-700">{(risk / baseRate).toFixed(1)}×</span> the base rate.
        </div>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-risk-high">Factors increasing risk</h3>
          <DriverList items={drivers.increasing} sign={1} max={max} />
        </div>
        <div>
          <h3 className="mb-3 text-sm font-semibold text-risk-low">Factors decreasing risk</h3>
          <DriverList items={drivers.decreasing} sign={-1} max={max} />
        </div>
      </div>
      <p className="mt-5 text-[11px] leading-relaxed text-muted">
        Contributions are exact TreeSHAP values for the model's uncalibrated score, in percentage points of that score. They explain what the model does, not why a customer behaves a certain way.
      </p>
    </div>
  )
}
