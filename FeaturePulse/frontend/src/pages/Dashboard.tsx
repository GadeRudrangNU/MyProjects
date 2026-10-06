import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { Kpi, Loading, PageHeader, Panel, SeverityBadge, fmt, useFetch } from '../components/ui'

const C = { primary: '#4f46e5', neg: '#dc2626', muted: '#94a3b8', grid: '#e2e8f0' }

export default function Dashboard() {
  const { data: d, error } = useFetch(() => api('/dashboard'), [])
  if (!d) return <Loading error={error} />
  const ev = d.evaluation
  const evDone = ev?.status === 'completed'
  const series = d.timeseries.filter((r: any) => r.count >= 30)
  return (
    <div>
      <PageHeader
        title="Feedback Command Center"
        subtitle={
          <>
            {fmt(d.total_feedback)} public app reviews{d.date_range ? ` (${d.date_range[0]} → ${d.date_range[1]})` : ''}. Themes are discovered by semantic clustering; trends compare the most recent {d.trend_window?.days ?? '—'}-day window with prior windows.
          </>
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <Kpi label="Feedback analyzed" value={fmt(d.total_feedback)} />
        <Kpi label="Negative feedback" value={`${d.negative_pct}%`} />
        <Kpi label="Themes" value={d.themes} hint={`${d.issue_themes} issue themes`} />
        <Kpi label="Emerging issues" value={d.emerging_issues} tone={d.emerging_issues ? 'warn' : undefined} hint={<Link className="text-brand-600" to="/emerging">view</Link>} />
        <Kpi label="Unresolved high priority" value={d.unresolved_high_priority} tone={d.unresolved_high_priority ? 'bad' : undefined} hint="high/critical, not on roadmap" />
        <Kpi
          label="Theme precision"
          value={evDone && ev.precision !== null ? `${(ev.precision * 100).toFixed(0)}%` : 'Pending'}
          hint={evDone ? `n=${ev.n_labeled} labeled` : 'Evaluation pending'}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Panel title="Feedback volume and negative share by month">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={series}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} interval={5} />
              <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} unit="%" domain={[0, 'auto']} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="count" name="Feedback" fill={C.primary} fillOpacity={0.85} />
              <Line yAxisId="r" dataKey="negative_pct" name="Negative %" stroke={C.neg} dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Average sentiment by month (−1 to +1)">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={series}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} interval={5} />
              <YAxis tick={{ fontSize: 11 }} domain={[-0.2, 1]} />
              <Tooltip />
              <Line dataKey="avg_sentiment" name="Avg sentiment" stroke={C.primary} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Themes by volume (top 12)" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={d.top_themes} layout="vertical" margin={{ left: 150 }}>
              <CartesianGrid stroke={C.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={150} />
              <Tooltip />
              <Bar dataKey="mentions" name="Mentions" fill={C.primary} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <div className="space-y-4">
          <Panel title="Source breakdown">
            <table className="w-full">
              <tbody>
                {d.sources.map((s: any) => (
                  <tr key={s.name}>
                    <td className="capitalize">{s.name.replace('_', ' ')}</td>
                    <td className="text-right tnum">{fmt(s.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 mt-2">Only one source type exists in the public dataset; upload a CSV to add more.</p>
          </Panel>
          <Panel title="Unresolved high-priority themes" right={<Link to="/prioritization" className="text-xs text-brand-600">Open studio</Link>}>
            {d.unresolved_high_priority_themes.length === 0 && <div className="text-sm text-slate-500">None — every high/critical theme is on the roadmap.</div>}
            <ul className="space-y-1.5">
              {d.unresolved_high_priority_themes.map((t: any) => (
                <li key={t.id} className="flex items-center justify-between text-sm">
                  <span className="truncate pr-2">{t.label}</span>
                  <span className="tnum text-slate-600">{t.priority.toFixed(0)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title="Feedback by product area (top 12 apps)" className="mt-4">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={d.product_areas}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={70} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="count" name="Feedback" fill={C.primary} />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-xs text-slate-500 mt-1">Product area = Android package name from the dataset. Per-app volume is capped during sampling (see data/README.md).</p>
      </Panel>
    </div>
  )
}

export { SeverityBadge }
