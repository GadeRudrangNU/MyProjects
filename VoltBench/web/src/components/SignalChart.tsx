import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { SeriesPoint } from '../live'
import type { Signal } from '../types'

interface Props {
  signal: Signal
  points: SeriesPoint[]
  showLimits: boolean
}

export function SignalChart({ signal, points, showLimits }: Props) {
  const values = points.map((p) => p.v)
  const lo = values.length ? Math.min(...values) : signal.nominal
  const hi = values.length ? Math.max(...values) : signal.nominal
  const pad = Math.max((hi - lo) * 0.15, signal.sigma * 2 || 0.5)
  const domain: [number, number] = showLimits
    ? [Math.min(lo, signal.range[0]) - pad, Math.max(hi, signal.range[1]) + pad]
    : [lo - pad, hi + pad]
  const last = values.length ? values[values.length - 1] : null
  const outside = last != null && (last < signal.hard[0] || last > signal.hard[1])

  return (
    <div className="chart-card" data-testid={`chart-${signal.name}`}>
      <div className="chart-head">
        <span>{signal.name}</span>
        <span className={outside ? 'bad' : 'muted'}>
          {last == null ? '–' : `${last.toFixed(signal.sigma < 0.1 ? 3 : 1)} ${signal.unit}`}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="t" hide type="number" domain={['dataMin', 'dataMax']} />
          <YAxis width={48} domain={domain} tickFormatter={(v: number) => v.toFixed(signal.sigma < 0.1 ? 2 : 0)} stroke="var(--muted)" fontSize={11} />
          {showLimits && (
            <>
              <ReferenceArea y1={signal.range[0]} y2={signal.range[1]} fill="var(--ok)" fillOpacity={0.08} />
              <ReferenceLine y={signal.hard[0]} stroke="var(--bad)" strokeDasharray="4 3" />
              <ReferenceLine y={signal.hard[1]} stroke="var(--bad)" strokeDasharray="4 3" />
            </>
          )}
          <Line type="monotone" dataKey="v" stroke="var(--accent)" dot={false} strokeWidth={1.6} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
