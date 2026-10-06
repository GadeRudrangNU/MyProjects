import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BUCKET_LABELS, api, qs } from '../api'
import { Loading, PageHeader, Panel, SentimentBadge, SeverityBadge, Tag, Trend, fmt, useDebounced, useFetch } from '../components/ui'

type Filters = Record<string, string>

export default function Themes() {
  const [f, setF] = useState<Filters>({ sort: 'mentions', kind: 'issue' })
  const df = useDebounced(f, 250)
  const opts = useFetch(() => api('/feedback/options'), [])
  const { data, error, reload } = useFetch(() => api('/themes' + qs(df)), [JSON.stringify(df)])
  const [open, setOpen] = useState<number | null>(null)
  const [sel, setSel] = useState<number[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }))

  const merge = async () => {
    const rows = (data as any[]).filter(t => sel.includes(t.id)).sort((a, b) => b.mentions - a.mentions)
    const target = rows[0]
    const label = window.prompt(`Merge ${rows.length} themes into one. Name for the merged theme:`, target.label)
    if (label === null) return
    const r = await api('/themes/merge', { json: { source_ids: rows.slice(1).map(t => t.id), target_id: target.id, label } })
    setMsg(`Merged ${r.merged.length} theme(s); ${fmt(r.feedback_moved)} feedback items moved.`)
    setSel([])
    reload()
  }

  return (
    <div>
      <PageHeader title="Theme Explorer" subtitle="Semantic clusters of feedback. Labels are generated from distinctive keywords — rename any theme and your name persists." />
      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3 flex flex-wrap gap-2 items-end text-sm">
        <Field label="Search theme"><input className="w-44" placeholder="keyword…" value={f.q ?? ''} onChange={e => set('q', e.target.value)} /></Field>
        <Field label="Type">
          <select value={f.kind ?? ''} onChange={e => set('kind', e.target.value)}>
            <option value="issue">Issues</option><option value="praise">Praise</option><option value="uncategorized">Uncategorized</option><option value="">All</option>
          </select>
        </Field>
        <Field label="Sentiment"><Sel v={f.sentiment} on={v => set('sentiment', v)} opts={opts.data?.sentiments} /></Field>
        <Field label="Severity"><Sel v={f.severity} on={v => set('severity', v)} opts={opts.data?.severities} /></Field>
        <Field label="Source"><Sel v={f.source} on={v => set('source', v)} opts={opts.data?.sources} /></Field>
        <Field label="Segment"><Sel v={f.segment} on={v => set('segment', v)} opts={opts.data?.segments} empty="(none in data)" /></Field>
        <Field label="Product area">
          <select className="w-44" value={f.product_area ?? ''} onChange={e => set('product_area', e.target.value)}>
            <option value="">All</option>{opts.data?.product_areas.map((o: string) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="From"><input type="date" value={f.date_from ?? ''} onChange={e => set('date_from', e.target.value)} /></Field>
        <Field label="To"><input type="date" value={f.date_to ?? ''} onChange={e => set('date_to', e.target.value)} /></Field>
        <Field label="Sort">
          <select value={f.sort} onChange={e => set('sort', e.target.value)}>
            <option value="mentions">Volume</option><option value="trend">Trend</option><option value="severity">Severity</option><option value="sentiment">Most negative</option><option value="label">Name</option>
          </select>
        </Field>
        <button className="btn ml-auto" onClick={() => setF({ sort: 'mentions', kind: 'issue' })}>Reset</button>
        <button className="btn btn-primary" disabled={sel.length < 2} onClick={merge}>Merge selected ({sel.length})</button>
      </div>
      {msg && <div className="mb-3 text-sm rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">{msg}</div>}
      {!data ? <Loading error={error} /> : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full">
            <thead><tr><th></th><th>Theme</th><th className="text-right">Mentions</th><th className="text-right">Trend</th><th>Severity</th><th className="text-right">Negative</th><th>Keywords</th></tr></thead>
            <tbody>
              {(data as any[]).map(t => (
                <tr key={t.id} className={`hover:bg-slate-50 cursor-pointer ${open === t.id ? 'bg-brand-50' : ''} ${t.ignored ? 'opacity-50' : ''}`} onClick={() => setOpen(t.id)}>
                  <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={sel.includes(t.id)} onChange={e => setSel(s => e.target.checked ? [...s, t.id] : s.filter(x => x !== t.id))} /></td>
                  <td className="font-medium text-slate-900">
                    {t.label}
                    {t.pm_label && <span className="ml-1.5 text-[10px] text-brand-700 bg-brand-50 border border-brand-100 rounded px-1">renamed</span>}
                    {t.emerging && <span className="ml-1.5 text-[10px] text-amber-800 bg-amber-100 rounded px-1">emerging</span>}
                    {t.ignored && <span className="ml-1.5 text-[10px] text-slate-600 bg-slate-200 rounded px-1">ignored</span>}
                  </td>
                  <td className="text-right tnum">{fmt(t.filtered_mentions ?? t.mentions)}{t.filtered_mentions !== undefined && <span className="text-slate-400"> / {fmt(t.mentions)}</span>}</td>
                  <td className="text-right"><Trend pct={t.trend_pct} /></td>
                  <td><SeverityBadge level={t.severity} overridden={!!t.severity_override} /></td>
                  <td className="text-right tnum">{t.negative_pct}%</td>
                  <td className="text-slate-500 text-xs max-w-xs truncate">{t.keywords.slice(0, 5).join(', ')}</td>
                </tr>
              ))}
              {(data as any[]).length === 0 && <tr><td colSpan={7} className="text-center text-slate-500 py-6">No themes match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {open !== null && <Drawer id={open} onClose={() => setOpen(null)} onChange={reload} />}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col text-[11px] font-medium text-slate-500 gap-0.5">{label}{children}</label>
}
function Sel({ v, on, opts, empty }: { v?: string; on: (v: string) => void; opts?: string[]; empty?: string }) {
  return (
    <select value={v ?? ''} onChange={e => on(e.target.value)}>
      <option value="">{opts && opts.length === 0 && empty ? empty : 'All'}</option>
      {opts?.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Drawer({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: () => void }) {
  const { data: t, error, reload } = useFetch(() => api(`/themes/${id}`), [id])
  const samples = useFetch(() => api('/feedback' + qs({ theme_id: id, page_size: 8, sentiment: 'negative' })), [id])
  const [name, setName] = useState<string | null>(null)
  const [bucket, setBucket] = useState('investigate')
  const [flash, setFlash] = useState<string | null>(null)
  const patch = async (body: object) => { await api(`/themes/${id}`, { method: 'PATCH', json: body }); reload(); onChange() }
  const promote = async () => {
    await api('/roadmap', { json: { theme_id: id, bucket, rationale: `Promoted from Theme Explorer (${t.mentions} mentions, ${t.severity} severity).` } })
    setFlash(`Added to roadmap as "${BUCKET_LABELS[bucket]}". Edit rationale on the Roadmap page.`)
    onChange()
  }
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="w-[620px] max-w-full h-full bg-white shadow-xl overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        {!t ? <Loading error={error} /> : (
          <>
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Theme #{t.id} · {t.kind}</div>
                <div className="flex gap-2 mt-1">
                  <input className="text-base font-semibold w-80" value={name ?? t.label} onChange={e => setName(e.target.value)} />
                  <button className="btn btn-primary" disabled={name === null || name === t.label} onClick={async () => { await patch({ label: name }); setName(null) }}>Save name</button>
                </div>
                {t.pm_label && <div className="text-xs text-slate-500 mt-1">Generated label: {t.generated_label} · <button className="text-brand-600" onClick={() => patch({ label: '' })}>reset</button></div>}
              </div>
              <button className="btn" onClick={onClose}>Close</button>
            </div>

            <div className="grid grid-cols-4 gap-2 mt-4 text-center">
              <Stat l="Mentions" v={fmt(t.mentions)} />
              <Stat l="Negative" v={`${t.negative_pct ?? 0}%`} />
              <Stat l="Trend" v={<Trend pct={t.trend_pct} />} />
              <Stat l="Avg sentiment" v={t.mean_sentiment?.toFixed(2)} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col text-xs text-slate-500 gap-1">Severity (computed: {t.severity_computed})
                <select value={t.severity_override ?? ''} onChange={e => patch({ severity_override: e.target.value || null })}>
                  <option value="">Use computed</option><option>low</option><option>medium</option><option>high</option><option>critical</option>
                </select>
              </label>
              <label className="flex flex-col text-xs text-slate-500 gap-1">Strategic fit: {t.strategic_fit}/10
                <input type="range" min={0} max={10} step={1} value={t.strategic_fit} onChange={e => patch({ strategic_fit: Number(e.target.value) })} />
              </label>
              <label className="flex items-center gap-2 text-sm col-span-2">
                <input type="checkbox" checked={t.ignored} onChange={e => patch({ ignored: e.target.checked })} /> Ignore this theme (excluded from prioritization)
              </label>
            </div>

            <div className="mt-4 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-md p-2">
              <span className="text-sm">Promote to roadmap:</span>
              <select value={bucket} onChange={e => setBucket(e.target.value)}>{Object.entries(BUCKET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button className="btn btn-primary" onClick={promote}>Promote</button>
              {flash && <span className="text-xs text-emerald-700">{flash}</span>}
            </div>

            <h3 className="mt-5 mb-1 text-sm font-semibold">Keywords</h3>
            <div>{t.keywords.map((k: string) => <Tag key={k}>{k}</Tag>)}</div>

            <h3 className="mt-4 mb-1 text-sm font-semibold">Volume by month</h3>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={t.monthly}><CartesianGrid vertical={false} stroke="#e2e8f0" /><XAxis dataKey="month" tick={{ fontSize: 10 }} interval={Math.ceil(t.monthly.length / 8)} /><YAxis tick={{ fontSize: 10 }} width={30} /><Tooltip /><Bar dataKey="count" fill="#4f46e5" /></BarChart>
            </ResponsiveContainer>

            <h3 className="mt-4 mb-1 text-sm font-semibold">Representative feedback (closest to theme centre)</h3>
            <ul className="space-y-2">
              {t.representative.map((r: any) => (
                <li key={r.id} className="text-sm border-l-2 border-brand-600 pl-2">
                  “{r.text}”
                  <div className="text-xs text-slate-500 mt-0.5"><Link className="text-brand-600" to={`/feedback/${r.id}`}>open</Link> · {r.product_area} · {r.created_at} · {r.rating ? `${r.rating}★` : 'no rating'}</div>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
              <Dist title="Sources" rows={t.sources} />
              <Dist title="Sentiment" rows={t.sentiment_breakdown} />
              <Dist title="Top product areas" rows={t.product_areas} />
              <Dist title="Segments" rows={t.segments.filter((s: any) => s.name !== 'unknown')} empty="Not available in this dataset" />
            </div>

            <h3 className="mt-4 mb-1 text-sm font-semibold">Related themes (nearest by embedding)</h3>
            <ul className="text-sm">{t.related_themes.map((r: any) => <li key={r.id}>{r.label} <span className="text-slate-400 tnum">sim {r.similarity}</span></li>)}</ul>

            <h3 className="mt-4 mb-1 text-sm font-semibold">Recent negative feedback in this theme</h3>
            <ul className="space-y-1.5 text-sm">
              {samples.data?.items.map((s: any) => (
                <li key={s.id}><Link to={`/feedback/${s.id}`} className="hover:underline">{s.text.slice(0, 160)}{s.text.length > 160 ? '…' : ''}</Link> <SentimentBadge label={s.sentiment} /> <SeverityBadge level={s.severity} /></li>
              ))}
            </ul>
            <Link className="btn mt-3" to={`/feedback?theme_id=${id}`}>See all feedback in theme</Link>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ l, v }: { l: string; v: React.ReactNode }) {
  return <div className="border border-slate-200 rounded-md py-2"><div className="text-[10px] uppercase text-slate-500">{l}</div><div className="font-semibold tnum">{v}</div></div>
}
function Dist({ title, rows, empty }: { title: string; rows: { name: string; count: number }[]; empty?: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-600 mb-1">{title}</div>
      {rows.length === 0 && <div className="text-xs text-slate-400">{empty ?? '—'}</div>}
      {rows.slice(0, 6).map(r => <div key={r.name} className="flex justify-between text-xs"><span className="truncate pr-2">{r.name}</span><span className="tnum text-slate-500">{fmt(r.count)}</span></div>)}
    </div>
  )
}
export { Panel }
