import { Fragment, useEffect, useRef, useState } from 'react'
import { BUCKET_LABELS, WEIGHT_KEYS, WEIGHT_LABELS, WeightKey, api } from '../api'
import { Loading, PageHeader, Panel, SeverityBadge, Trend, fmt, useDebounced } from '../components/ui'

const COLORS: Record<WeightKey, string> = {
  frequency: '#4f46e5', severity: '#dc2626', trend: '#ea580c', customer_impact: '#0891b2', sentiment: '#7c3aed', strategic_fit: '#16a34a',
}
const DEFAULTS: Record<WeightKey, number> = { frequency: 25, severity: 20, trend: 15, customer_impact: 15, sentiment: 10, strategic_fit: 15 }

export default function Prioritization() {
  const [w, setW] = useState<Record<WeightKey, number> | null>(null)
  const [res, setRes] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [why, setWhy] = useState<number | null>(null)
  const [praise, setPraise] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const dw = useDebounced(w, 120)
  const first = useRef(true)

  // load saved weights once
  useEffect(() => {
    api('/priorities').then(r => {
      const sum = Object.values(r.weights as Record<string, number>).reduce((a, b) => a + b, 0) || 1
      const init = {} as Record<WeightKey, number>
      WEIGHT_KEYS.forEach(k => (init[k] = Math.round((100 * r.weights[k]) / sum)))
      setW(init)
      setRes(r)
    }).catch(e => setError(e.message))
  }, [])

  // recompute ranking on the server whenever weights change (server is the single source of truth)
  useEffect(() => {
    if (!dw) return
    if (first.current) { first.current = false; return }
    api('/priorities/recalculate', { json: { weights: dw, include_praise: praise } }).then(setRes).catch(e => setError(e.message))
  }, [dw, praise])

  if (!w || !res) return <Loading error={error} />
  const total = Object.values(w).reduce((a, b) => a + b, 0)

  const save = async () => {
    await api('/priorities/recalculate', { json: { weights: w, save: true, include_praise: praise } })
    setSaved('Weights saved.'); setTimeout(() => setSaved(null), 2500)
  }
  const setFit = async (id: number, v: number) => {
    await api(`/themes/${id}`, { method: 'PATCH', json: { strategic_fit: v } })
    setRes(await api('/priorities/recalculate', { json: { weights: w, include_praise: praise } }))
  }
  const promote = async (id: number, bucket: string, score: number) => {
    await api('/roadmap', { json: { theme_id: id, bucket, rationale: `Ranked by FeaturePulse priority score ${score.toFixed(0)}/100.` } })
    setRes(await api('/priorities/recalculate', { json: { weights: w, include_praise: praise } }))
  }

  return (
    <div>
      <PageHeader title="Prioritization Studio" subtitle="Priority = Σ weight × component, each component normalized to 0–1 across the themes shown. Move a slider and the backlog re-ranks. Open “Why this rank?” for the exact arithmetic." />
      <div className="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
        <Panel title="Scoring weights" className="lg:sticky lg:top-4">
          {WEIGHT_KEYS.map(k => (
            <div key={k} className="mb-3">
              <div className="flex justify-between text-sm">
                <span className="flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[k] }} />{WEIGHT_LABELS[k]}</span>
                <span className="tnum text-slate-600">{total ? Math.round((100 * w[k]) / total) : 0}%</span>
              </div>
              <input type="range" min={0} max={100} value={w[k]} onChange={e => setW({ ...w, [k]: Number(e.target.value) })} className="w-full" />
            </div>
          ))}
          <div className="text-xs text-slate-500 mb-2">Sliders are relative importance; they are normalized to 100%.</div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setW(DEFAULTS)}>Reset</button>
            <button className="btn btn-primary" onClick={save}>Save weights</button>
          </div>
          {saved && <div className="text-xs text-emerald-700 mt-2">{saved}</div>}
          <label className="flex items-center gap-1.5 text-xs mt-3"><input type="checkbox" checked={praise} onChange={e => setPraise(e.target.checked)} /> Include praise themes</label>
          <div className="text-[11px] text-slate-500 mt-3 leading-relaxed">
            Excluded: {res.excluded}. Revenue / business impact is not scored because the dataset has no revenue or customer-value field.
          </div>
        </Panel>

        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr><th>#</th><th>Theme</th><th className="text-right">Frequency</th><th>Severity</th><th className="text-right">Trend</th><th className="text-right">Impact</th><th className="text-right">Fit (0–10)</th><th style={{ width: 170 }}>Priority</th><th></th></tr>
            </thead>
            <tbody>
              {res.items.slice(0, 40).map((r: any) => (
                <Fragment key={r.theme_id}>
                  <tr className={why === r.theme_id ? 'bg-brand-50' : ''}>
                    <td className="tnum text-slate-500">{r.rank}</td>
                    <td className="font-medium max-w-[260px]">
                      {r.label}
                      {r.emerging && <span className="ml-1.5 text-[10px] text-amber-800 bg-amber-100 rounded px-1">emerging</span>}
                      {r.roadmap_bucket && <span className="ml-1.5 text-[10px] text-brand-700 bg-brand-100 rounded px-1">{BUCKET_LABELS[r.roadmap_bucket]}</span>}
                    </td>
                    <td className="text-right tnum">{fmt(r.mentions)}</td>
                    <td><SeverityBadge level={r.severity} overridden={r.severity_overridden} /></td>
                    <td className="text-right"><Trend pct={r.trend_pct} /></td>
                    <td className="text-right tnum" title="Negative-sentiment mentions">{fmt(r.negative_mentions)}</td>
                    <td className="text-right"><select value={Math.round(r.strategic_fit)} onChange={e => setFit(r.theme_id, Number(e.target.value))}>{Array.from({ length: 11 }, (_, i) => <option key={i}>{i}</option>)}</select></td>
                    <td>
                      <div className="flex items-center gap-2"><div className="flex-1 h-2 rounded bg-slate-100 overflow-hidden flex">
                        {WEIGHT_KEYS.map(k => <div key={k} style={{ width: `${r.contributions[k]}%`, background: COLORS[k] }} />)}
                      </div><span className="tnum font-semibold w-8 text-right">{r.priority.toFixed(0)}</span></div>
                    </td>
                    <td className="whitespace-nowrap"><button className="text-brand-600 text-xs" onClick={() => setWhy(why === r.theme_id ? null : r.theme_id)}>Why this rank?</button></td>
                  </tr>
                  {why === r.theme_id && (
                    <tr><td colSpan={9} className="bg-slate-50 p-4"><Why r={r} onPromote={promote} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Why({ r, onPromote }: { r: any; onPromote: (id: number, b: string, s: number) => void }) {
  const [bucket, setBucket] = useState('next')
  const sum = WEIGHT_KEYS.reduce((a, k) => a + r.contributions[k], 0)
  const rawText: Record<WeightKey, string> = {
    frequency: `${fmt(r.raw.frequency)} mentions (log scale, min–max across backlog)`,
    severity: `${r.severity}${r.severity_overridden ? ' (PM override)' : ''}, mean rule score ${r.raw.severity.toFixed(2)}`,
    trend: r.raw.trend === null ? 'no baseline' : `${r.raw.trend > 0 ? '+' : ''}${r.raw.trend.toFixed(0)}% volume-adjusted vs. baseline`,
    customer_impact: `${fmt(r.raw.customer_impact)} negative mentions (log scale, min–max across backlog)`,
    sentiment: `mean sentiment ${r.raw.sentiment.toFixed(2)} (−1 … +1)`,
    strategic_fit: `PM score ${r.raw.strategic_fit}/10`,
  }
  return (
    <div className="grid md:grid-cols-[1fr_260px] gap-6">
      <div>
        <div className="text-sm font-semibold mb-2">Priority {r.priority.toFixed(1)} / 100 — rank #{r.rank}</div>
        <table className="w-full text-sm">
          <thead><tr><th>Component</th><th>Evidence</th><th className="text-right">Component (0–1)</th><th className="text-right">× Weight</th><th className="text-right">= Points</th></tr></thead>
          <tbody>
            {WEIGHT_KEYS.map(k => (
              <tr key={k}>
                <td><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style={{ background: COLORS[k] }} />{WEIGHT_LABELS[k]}</td>
                <td className="text-xs text-slate-600">{rawText[k]}</td>
                <td className="text-right tnum">{r.components[k].toFixed(2)}</td>
                <td className="text-right tnum">{(100 * r.weights[k]).toFixed(0)}%</td>
                <td className="text-right tnum font-semibold">{r.contributions[k].toFixed(1)}</td>
              </tr>
            ))}
            <tr><td colSpan={4} className="text-right font-semibold">Total</td><td className="text-right tnum font-bold">{sum.toFixed(1)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="text-sm">
        <div className="text-xs text-slate-500 mb-1">Keywords</div>
        <div className="text-xs mb-3">{r.keywords.join(', ')}</div>
        <div className="text-xs text-slate-500 mb-1">Decide</div>
        <div className="flex gap-2">
          <select value={bucket} onChange={e => setBucket(e.target.value)}>{Object.entries(BUCKET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <button className="btn btn-primary" onClick={() => onPromote(r.theme_id, bucket, r.priority)}>Promote</button>
        </div>
      </div>
    </div>
  )
}
