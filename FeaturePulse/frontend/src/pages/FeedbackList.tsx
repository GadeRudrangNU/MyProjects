import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, qs } from '../api'
import { Loading, PageHeader, SentimentBadge, SeverityBadge, fmt, useDebounced, useFetch } from '../components/ui'

export default function FeedbackList() {
  const [sp, setSp] = useSearchParams()
  const [semantic, setSemantic] = useState(false)
  const [page, setPage] = useState(1)
  const f = Object.fromEntries(sp.entries())
  const df = useDebounced(f, 300)
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v); else n.delete(k)
    setSp(n); setPage(1)
  }
  const opts = useFetch(() => api('/feedback/options'), [])
  const themes = useFetch(() => api('/themes' + qs({ kind: '' })), [])
  const useSem = semantic && (df.q ?? '').length >= 3
  const { data, error } = useFetch(
    () => (useSem ? api('/feedback/search' + qs({ q: df.q, k: 25 })).then(r => ({ items: r.results, total: r.results.length })) : api('/feedback' + qs({ ...df, page, page_size: 25 }))),
    [JSON.stringify(df), page, useSem],
  )
  return (
    <div>
      <PageHeader title="Feedback" subtitle="Every record with its assigned theme. Turn on semantic search to find feedback by meaning (LangChain retriever over pgvector) instead of keywords." />
      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-3 flex flex-wrap gap-2 items-end text-sm">
        <label className="flex flex-col text-[11px] font-medium text-slate-500 gap-0.5">Search<input className="w-64" placeholder={semantic ? 'describe the problem…' : 'text contains…'} value={f.q ?? ''} onChange={e => set('q', e.target.value)} /></label>
        <label className="flex items-center gap-1 text-xs pb-1.5"><input type="checkbox" checked={semantic} onChange={e => setSemantic(e.target.checked)} /> Semantic</label>
        <Sel label="Theme" v={f.theme_id} on={v => set('theme_id', v)} options={(themes.data ?? []).map((t: any) => [String(t.id), `${t.label} (${t.mentions})`])} />
        <Sel label="Sentiment" v={f.sentiment} on={v => set('sentiment', v)} options={(opts.data?.sentiments ?? []).map((s: string) => [s, s])} />
        <Sel label="Severity" v={f.severity} on={v => set('severity', v)} options={(opts.data?.severities ?? []).map((s: string) => [s, s])} />
        <Sel label="Source" v={f.source} on={v => set('source', v)} options={(opts.data?.sources ?? []).map((s: string) => [s, s])} />
        <Sel label="Product area" v={f.product_area} on={v => set('product_area', v)} options={(opts.data?.product_areas ?? []).map((s: string) => [s, s])} />
        <label className="flex flex-col text-[11px] font-medium text-slate-500 gap-0.5">From<input type="date" value={f.date_from ?? ''} onChange={e => set('date_from', e.target.value)} /></label>
        <label className="flex flex-col text-[11px] font-medium text-slate-500 gap-0.5">To<input type="date" value={f.date_to ?? ''} onChange={e => set('date_to', e.target.value)} /></label>
        <button className="btn ml-auto" onClick={() => setSp({})}>Reset</button>
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full">
              <thead><tr><th>Date</th><th>Feedback</th><th>Theme</th><th>Rating</th><th>Sentiment</th><th>Severity</th><th>Product</th></tr></thead>
              <tbody>
                {data.items.map((i: any) => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="tnum text-slate-500 whitespace-nowrap">{i.created_at ?? '—'}</td>
                    <td className="max-w-xl"><Link to={`/feedback/${i.id}`} className="hover:underline">{i.text.length > 220 ? i.text.slice(0, 220) + '…' : i.text}</Link></td>
                    <td className="text-xs max-w-[180px]">{i.theme_label}{i.assigned_by === 'pm' && <span className="ml-1 text-[10px] text-brand-700">(PM)</span>}</td>
                    <td className="tnum">{i.rating ? `${i.rating}★` : '—'}</td>
                    <td><SentimentBadge label={i.sentiment} /></td>
                    <td><SeverityBadge level={i.severity} /></td>
                    <td className="text-xs text-slate-500 max-w-[150px] truncate">{i.product_area ?? '—'}</td>
                  </tr>
                ))}
                {data.items.length === 0 && <tr><td colSpan={7} className="text-center text-slate-500 py-6">No feedback matches.</td></tr>}
              </tbody>
            </table>
          </div>
          {!useSem && (
            <div className="flex items-center justify-between mt-3 text-sm text-slate-600">
              <span className="tnum">{fmt(data.total)} records</span>
              <div className="flex gap-2 items-center">
                <button className="btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
                <span className="tnum">Page {page} / {Math.max(1, Math.ceil(data.total / 25))}</span>
                <button className="btn" disabled={page >= Math.ceil(data.total / 25)} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Sel({ label, v, on, options }: { label: string; v?: string; on: (v: string) => void; options: string[][] }) {
  return (
    <label className="flex flex-col text-[11px] font-medium text-slate-500 gap-0.5">{label}
      <select className="max-w-[190px]" value={v ?? ''} onChange={e => on(e.target.value)}>
        <option value="">All</option>
        {options.map(([val, text]) => <option key={val} value={val}>{text}</option>)}
      </select>
    </label>
  )
}
