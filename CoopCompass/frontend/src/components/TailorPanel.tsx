import { useState } from 'react'
import { api, ApiError } from '../api'
import { errMessage } from '../lib/format'
import type { Suggestion, Tailoring } from '../types'
import { useAsync } from '../hooks/useAsync'
import { Badge, CopyButton, EmptyState, ErrorState, Spinner } from './ui'

export const providerLabel = (p: string) => (p === 'gemini' ? 'Gemini' : 'Local rules')

function SuggestionCard({ s, onSet }: { s: Suggestion; onSet: (st: 'accepted' | 'rejected' | 'pending') => void }) {
  const text = s.suggested ?? s.original
  return (
    <li className="card p-4" data-testid="suggestion" data-status={s.status}>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs font-semibold tracking-wide text-slate-500">ORIGINAL</div>
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-sm text-slate-800">{s.original}</p>
        </div>
        <div>
          <div className="text-xs font-semibold tracking-wide text-accent-700">SUGGESTED</div>
          {s.suggested ? (
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-accent-50 p-2 text-sm text-slate-900">{s.suggested}</p>
          ) : (
            <p className="mt-1 rounded-md bg-slate-50 p-2 text-sm italic text-slate-600">
              Local rules mode gives guidance only — no rewritten text. Consider leading with this bullet for the highlighted terms.
            </p>
          )}
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-700"><span className="font-medium">Why:</span> {s.rationale}</p>
      {s.jd_terms.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-600">Job terms:</span>
          {s.jd_terms.map((t) => <Badge key={t} tone="indigo">{t}</Badge>)}
        </div>
      )}
      <div className="mt-3 rounded-md border-l-4 border-emerald-500 bg-emerald-50 p-2" data-testid="source-evidence">
        <div className="text-xs font-semibold tracking-wide text-emerald-900">SOURCE EVIDENCE · {s.source_evidence.section}</div>
        <p className="mt-0.5 text-sm text-emerald-950">{s.source_evidence.text}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={`btn btn-sm ${s.status === 'accepted' ? 'btn-primary' : ''}`} aria-pressed={s.status === 'accepted'} onClick={() => onSet(s.status === 'accepted' ? 'pending' : 'accepted')} data-testid="accept">
          {s.status === 'accepted' ? '✓ Accepted' : 'Accept'}
        </button>
        <button className="btn btn-sm" aria-pressed={s.status === 'rejected'} onClick={() => onSet(s.status === 'rejected' ? 'pending' : 'rejected')} data-testid="reject">
          {s.status === 'rejected' ? '✕ Rejected' : 'Reject'}
        </button>
        {s.status === 'accepted' && <CopyButton text={text} label={s.suggested ? 'Copy accepted text' : 'Copy bullet'} />}
      </div>
    </li>
  )
}

export function TailorPanel({ jobId }: { jobId: number }) {
  const existing = useAsync(() => api.getTailoring(jobId), [jobId])
  const [fresh, setFresh] = useState<Tailoring | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [patchErr, setPatchErr] = useState<string | null>(null)

  const tailoring = fresh ?? existing.data ?? null

  const generate = async () => {
    setBusy(true); setErr(null)
    try { setFresh(await api.tailor(jobId)) } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  const setStatus = async (s: Suggestion, status: 'accepted' | 'rejected' | 'pending') => {
    if (!tailoring) return
    setPatchErr(null)
    try {
      const updated = await api.setSuggestion(tailoring.generation_id, s.index, status)
      setFresh({ ...tailoring, suggestions: tailoring.suggestions.map((x) => (x.index === s.index ? updated : x)) })
    } catch (e) { setPatchErr(errMessage(e)) }
  }

  if (existing.loading && !fresh) return <Spinner label="Loading suggestions…" />
  if (existing.error && !fresh) return <ErrorState error={existing.error} onRetry={existing.reload} />

  const profileRequired = err instanceof ApiError && err.code === 'profile_required'

  return (
    <div data-testid="tailor-panel">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" onClick={() => void generate()} disabled={busy} data-testid="generate-suggestions">
          {busy ? 'Generating…' : tailoring ? 'Regenerate suggestions' : 'Generate suggestions'}
        </button>
        {tailoring && <Badge tone="slate">Source: {providerLabel(tailoring.provider)}{tailoring.cached ? ' · cached' : ''}</Badge>}
      </div>
      {err !== null && (profileRequired
        ? <p role="alert" className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Create your profile first. Suggestions are built only from evidence in your profile.</p>
        : <div className="mb-3"><ErrorState error={err} onRetry={() => void generate()} /></div>)}
      {patchErr && <p role="alert" className="mb-2 text-sm text-red-700">{patchErr}</p>}
      {tailoring ? (
        <>
          <p className="mb-3 rounded-md bg-slate-100 p-2 text-sm text-slate-700" data-testid="tailor-notice">{tailoring.notice}</p>
          {tailoring.suggestions.length === 0
            ? <EmptyState title="No suggestions">No bullets in your profile matched this job's terms closely enough. Add more evidence items to your profile.</EmptyState>
            : <ul className="grid gap-3">{tailoring.suggestions.map((s) => <SuggestionCard key={s.index} s={s} onSet={(st) => void setStatus(s, st)} />)}</ul>}
        </>
      ) : (
        <EmptyState title="No suggestions yet">Suggestions only re-use facts that already exist in your profile evidence, and you decide what to accept. Click Generate suggestions to start.</EmptyState>
      )}
    </div>
  )
}
