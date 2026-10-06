import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BUCKET_LABELS, api } from '../api'
import { Loading, PageHeader, SeverityBadge, Trend, fmt, useFetch } from '../components/ui'

export default function Roadmap() {
  const { data, error, reload } = useFetch(() => api('/roadmap'), [])
  const [edit, setEdit] = useState<any | null>(null)
  if (!data) return <Loading error={error} />
  const move = async (id: number, bucket: string) => { await api(`/roadmap/${id}`, { method: 'PATCH', json: { bucket } }); reload() }
  return (
    <div>
      <PageHeader title="Roadmap Candidates" subtitle="Themes you have promoted into a decision. Each card keeps your rationale and evidence; the live priority score is shown next to the score at the time you promoted it." />
      {data.items.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No roadmap items yet. Promote a theme from <Link className="text-brand-600" to="/prioritization">Prioritization Studio</Link> or <Link className="text-brand-600" to="/themes">Theme Explorer</Link>.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
        {data.buckets.map((b: string) => {
          const items = data.items.filter((i: any) => i.bucket === b)
          return (
            <div key={b} className="bg-slate-100/70 rounded-lg p-2 min-h-[200px]">
              <div className="flex justify-between px-1 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600"><span>{BUCKET_LABELS[b]}</span><span className="tnum">{items.length}</span></div>
              <div className="space-y-2">
                {items.map((i: any) => (
                  <div key={i.id} className="bg-white border border-slate-200 rounded-md p-2.5 text-sm">
                    <div className="font-medium leading-snug">{i.theme_label}</div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 flex-wrap">
                      {i.severity && <SeverityBadge level={i.severity} />}<span className="tnum">{fmt(i.mentions)} mentions</span><Trend pct={i.trend_pct} />
                    </div>
                    <div className="text-xs mt-1 text-slate-600 tnum">Priority now <b>{i.current_priority?.toFixed(0) ?? '—'}</b>{i.priority_snapshot !== null && <> · at promotion {i.priority_snapshot?.toFixed(0)}</>}</div>
                    <div className="text-[11px] mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 capitalize">{i.status.replace('_', ' ')}</div>
                    {i.rationale && <p className="text-xs mt-1.5 text-slate-700">{i.rationale}</p>}
                    {i.notes && <p className="text-xs mt-1 text-slate-500 italic">{i.notes}</p>}
                    {i.evidence_links.length > 0 && <div className="text-xs mt-1">{i.evidence_links.map((l: string) => <div key={l} className="truncate"><Link className="text-brand-600" to={l.startsWith('/') ? l : '#'}>{l}</Link></div>)}</div>}
                    <div className="flex gap-1 mt-2 items-center flex-wrap">
                      <select className="text-xs py-0.5 w-24" value={i.bucket} onChange={e => move(i.id, e.target.value)}>{Object.entries(BUCKET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <button className="btn text-xs py-0.5" onClick={() => setEdit(i)}>Edit</button>
                      <Link className="btn text-xs py-0.5" to={`/feedback?theme_id=${i.theme_id}`}>Evidence</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {edit && <EditModal item={edit} statuses={data.statuses} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
    </div>
  )
}

function EditModal({ item, statuses, onClose, onSaved }: { item: any; statuses: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ status: item.status, rationale: item.rationale ?? '', notes: item.notes ?? '', links: (item.evidence_links ?? []).join('\n') })
  const save = async () => {
    await api(`/roadmap/${item.id}`, { method: 'PATCH', json: { status: f.status, rationale: f.rationale, notes: f.notes, evidence_links: f.links.split('\n').map((s: string) => s.trim()).filter(Boolean) } })
    onSaved()
  }
  const remove = async () => { if (confirm('Remove this theme from the roadmap?')) { await api(`/roadmap/${item.id}`, { method: 'DELETE' }); onSaved() } }
  return (
    <div className="fixed inset-0 z-20 bg-slate-900/30 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[520px] max-w-full p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold mb-3">{item.theme_label}</h3>
        <label className="block text-xs text-slate-500 mb-3">Status
          <select className="block w-full mt-1" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{statuses.map(s => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="block text-xs text-slate-500 mb-3">Rationale (why this decision?)
          <textarea className="block w-full mt-1" rows={3} value={f.rationale} onChange={e => setF({ ...f, rationale: e.target.value })} />
        </label>
        <label className="block text-xs text-slate-500 mb-3">PM notes
          <textarea className="block w-full mt-1" rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />
        </label>
        <label className="block text-xs text-slate-500 mb-4">Evidence links (one per line, e.g. /feedback/&lt;id&gt; or a URL)
          <textarea className="block w-full mt-1" rows={2} value={f.links} onChange={e => setF({ ...f, links: e.target.value })} />
        </label>
        <div className="flex justify-between"><button className="btn btn-danger" onClick={remove}>Remove</button><div className="flex gap-2"><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></div></div>
      </div>
    </div>
  )
}
