import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Analytics } from '../types'

const ACCENT = '#4f46e5'
const TEAL = '#0d9488'
const SLATE = '#64748b'

export function FunnelChart({ funnel }: { funnel: Analytics['funnel'] }) {
  const max = Math.max(1, ...funnel.map((f) => f.count))
  return (
    <div data-testid="funnel" role="figure" aria-label="Application funnel">
      <ul className="grid gap-2">
        {funnel.map((f) => (
          <li key={f.stage} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-2 text-sm">
            <span className="truncate text-slate-700">{f.label}</span>
            <span className="h-5 rounded bg-slate-100">
              <span className="block h-5 rounded bg-accent-600" style={{ width: `${(f.count / max) * 100}%`, minWidth: f.count > 0 ? 4 : 0 }} />
            </span>
            <span className="text-right font-medium tabular-nums text-slate-900">{f.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function WeeklyChart({ data }: { data: Analytics['weekly_activity'] }) {
  const rows = data.map((d) => ({ ...d, week: d.week_start.slice(5) }))
  return (
    <div className="h-64 w-full" data-testid="weekly-chart" role="figure" aria-label="Weekly activity, last 8 weeks">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="jobs_analyzed" name="Jobs analyzed" fill={SLATE} radius={[2, 2, 0, 0]} />
          <Bar dataKey="applications_started" name="Applications started" fill={ACCENT} radius={[2, 2, 0, 0]} />
          <Bar dataKey="applications_submitted" name="Submitted" fill={TEAL} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function GapBarChart({ data }: { data: Analytics['skill_gap_frequency'] }) {
  const rows = data.slice(0, 12)
  return (
    <div style={{ height: Math.max(160, rows.length * 28 + 40) }} data-testid="gap-chart" role="figure" aria-label="Most frequent skill gaps">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="skill" width={110} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v, _n, p) => [`${v} jobs (${Math.round(((p.payload as { share: number }).share <= 1 ? (p.payload as { share: number }).share * 100 : (p.payload as { share: number }).share))}%)`, 'Gap in']} />
          <Bar dataKey="count" fill={ACCENT} radius={[0, 2, 2, 0]} label={{ position: 'right', fontSize: 11 }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
