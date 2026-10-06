import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { Loading, PageHeader, Panel, SentimentBadge, SeverityBadge, useFetch } from '../components/ui'

export default function FeedbackDetail() {
  const { id } = useParams()
  const { data: f, error, reload } = useFetch(() => api(`/feedback/${id}`), [id])
  const themes = useFetch(() => api('/themes?kind='), [])
  const [target, setTarget] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  if (!f) return <Loading error={error} />
  const correct = async () => {
    setErr(null)
    try {
      await api(`/feedback/${f.id}/correct-theme`, { json: { new_theme_id: Number(target) } })
      setMsg('Correction saved. It is stored in theme_corrections as a labeled example for future model improvement.')
      setTarget(''); reload()
    } catch (e: any) { setErr(e.message) }
  }
  const signals = Object.entries(f.severity_signals ?? {}) as [string, number][]
  return (
    <div>
      <PageHeader title="Feedback detail" subtitle={<Link to="/feedback" className="text-brand-600">← all feedback</Link>} />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Panel title="Original feedback">
            <p className="text-base leading-relaxed whitespace-pre-wrap">“{f.text}”</p>
            <div className="mt-3 text-xs text-slate-500 flex flex-wrap gap-x-5 gap-y-1">
              <span>Source: <b>{f.source ?? 'unknown'}</b></span>
              <span>Date: <b>{f.created_at ?? 'unknown'}</b></span>
              <span>Rating: <b>{f.rating ? `${f.rating}★` : 'unknown'}</b></span>
              <span>Product: <b>{f.product_area ?? 'unknown'}</b></span>
              <span>Segment: <b>{f.customer_segment ?? 'unknown'}</b></span>
              {f.synthetic && <span className="text-amber-700 font-semibold">synthetic record</span>}
            </div>
          </Panel>
          <Panel title="Similar feedback (pgvector nearest neighbours)">
            <ul className="space-y-2">
              {f.similar.map((s: any) => (
                <li key={s.feedback_id} className="text-sm flex justify-between gap-3">
                  <Link to={`/feedback/${s.feedback_id}`} className="hover:underline">{s.text.length > 200 ? s.text.slice(0, 200) + '…' : s.text}</Link>
                  <span className="tnum text-xs text-slate-500 shrink-0">sim {s.similarity}</span>
                </li>
              ))}
              {f.similar.length === 0 && <li className="text-sm text-slate-500">No neighbours found.</li>}
            </ul>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Analysis">
            <dl className="text-sm space-y-2">
              <div className="flex justify-between"><dt className="text-slate-500">Sentiment</dt><dd><SentimentBadge label={f.sentiment} /> <span className="tnum text-xs text-slate-500">{f.sentiment_score}</span></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Severity</dt><dd><SeverityBadge level={f.severity} /> <span className="tnum text-xs text-slate-500">{f.severity_score}</span></dd></div>
              <div><dt className="text-slate-500 mb-1">Severity signals</dt>
                <dd>{signals.length === 0 ? <span className="text-xs text-slate-400">none triggered</span> : signals.map(([k, v]) => <div key={k} className="flex justify-between text-xs"><span>{k.replace(/_/g, ' ')}</span><span className="tnum">+{v}</span></div>)}</dd></div>
            </dl>
          </Panel>
          <Panel title="Assigned theme">
            <div className="font-medium">{f.theme_label}</div>
            <div className="text-xs text-slate-500 mt-0.5">{f.assigned_by === 'pm' ? 'Assigned by PM' : `Model assignment, cosine similarity to theme centre ${f.similarity_to_theme ?? '—'}`}</div>
            <Link className="text-xs text-brand-600" to={`/feedback?theme_id=${f.theme_id}`}>View theme feedback</Link>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="text-xs font-semibold mb-1">Correct the theme</div>
              <select className="w-full" value={target} onChange={e => setTarget(e.target.value)}>
                <option value="">Choose the right theme…</option>
                {(themes.data ?? []).filter((t: any) => t.id !== f.theme_id).map((t: any) => <option key={t.id} value={t.id}>{t.label} ({t.mentions})</option>)}
              </select>
              <button className="btn btn-primary mt-2" disabled={!target} onClick={correct}>Save correction</button>
              {msg && <div className="text-xs text-emerald-700 mt-2">{msg}</div>}
              {err && <div className="text-xs text-red-700 mt-2">{err}</div>}
            </div>
            {f.corrections.length > 0 && (
              <div className="mt-3 text-xs text-slate-500">
                History: {f.corrections.map((c: any, i: number) => <div key={i}>#{c.old_theme} → #{c.new_theme} at {c.timestamp.slice(0, 16).replace('T', ' ')}</div>)}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
