import { useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis } from 'recharts'
import { api, qs } from '../api'
import { Loading, PageHeader, Panel, SeverityBadge, Trend, fmt, useFetch } from '../components/ui'

export default function Emerging() {
  const [all, setAll] = useState(false)
  const { data, error } = useFetch(() => api('/emerging' + qs({ all })), [all])
  if (!data) return <Loading error={error} />
  const w = data.window
  return (
    <div>
      <PageHeader
        title="Emerging Issues"
        subtitle="Themes whose volume in the most recent window is unusually high versus a baseline of earlier windows of the same length, after adjusting for overall volume growth."
        actions={<label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show every theme (incl. unflagged and praise)</label>}
      />
      {w && (
        <Panel className="mb-4">
          <div className="text-sm grid md:grid-cols-3 gap-4">
            <div><div className="text-xs text-slate-500">Recent window ({w.days} days, auto-selected)</div><div className="font-medium tnum">{w.recent_start} → {w.recent_end}</div><div className="text-xs text-slate-500">{fmt(w.recent_total_records)} records</div></div>
            <div><div className="text-xs text-slate-500">Baseline</div><div className="font-medium">{w.baseline_windows} prior windows of {w.days} days</div><div className="text-xs text-slate-500 tnum">records: {w.baseline_total_records.join(', ')}</div></div>
            <div><div className="text-xs text-slate-500">Flag rule (all must hold)</div><div className="text-xs">≥ {data.criteria.min_recent_count} recent mentions · volume-adjusted z ≥ {data.criteria.min_z_score} · volume-adjusted increase ≥ {data.criteria.min_volume_adjusted_increase_pct}%</div></div>
          </div>
        </Panel>
      )}
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full">
          <thead><tr><th>Theme</th><th>Severity</th><th className="text-right">Recent</th><th className="text-right">Baseline avg</th><th className="text-right">Abs. change</th><th className="text-right">% change (raw)</th><th className="text-right">Share change (adj.)</th><th className="text-right">z-score</th><th>Last 7 windows</th><th>Why flagged</th></tr></thead>
          <tbody>
            {data.items.map((r: any) => {
              const spark = [...r.baseline_counts].reverse().map((c: number) => ({ c })).concat([{ c: r.recent_count }])
              return (
                <tr key={r.id}>
                  <td className="font-medium">{r.label}{r.flagged && <span className="ml-1.5 text-[10px] text-amber-800 bg-amber-100 rounded px-1">emerging</span>}</td>
                  <td><SeverityBadge level={r.severity} /></td>
                  <td className="text-right tnum">{r.recent_count}</td>
                  <td className="text-right tnum">{r.baseline_mean}</td>
                  <td className="text-right tnum">{r.absolute_increase > 0 ? '+' : ''}{r.absolute_increase}</td>
                  <td className="text-right"><Trend pct={r.pct_increase === null ? null : r.pct_increase * 100} /></td>
                  <td className="text-right"><Trend pct={r.share_change * 100} /></td>
                  <td className="text-right tnum">{r.z_score}</td>
                  <td style={{ width: 120 }}>
                    <ResponsiveContainer width={110} height={32}><BarChart data={spark}><XAxis hide /><Bar dataKey="c">{spark.map((_: any, i: number) => <Cell key={i} fill={i === spark.length - 1 ? '#dc2626' : '#94a3b8'} />)}</Bar></BarChart></ResponsiveContainer>
                  </td>
                  <td className="text-xs text-slate-600 max-w-xs">{r.reason || '—'}</td>
                </tr>
              )
            })}
            {data.items.length === 0 && <tr><td colSpan={10} className="text-center text-slate-500 py-6">No theme meets the anomaly criteria in the latest window — nothing to escalate.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 mt-3">Raw % change uses counts; share change controls for overall volume growth (a theme must grow faster than total feedback to be flagged). z-score compares the recent share to the spread of baseline-window shares, floored by binomial sampling noise.</p>
    </div>
  )
}
