import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../AppContext'
import { MatchRing } from '../components/MatchRing'
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { deadlineText, errMessage } from '../lib/format'
import { buildColumns, type TrackerCard } from '../lib/tracker'
import { STATUSES } from '../types'

export function TrackerPage() {
  const { dataVersion, bumpData, openAddJob } = useApp()
  const apps = useAsync(() => api.listApplications(), [dataVersion])
  const jobs = useAsync(() => api.listJobs({ status: 'new', sort: 'best_match' }), [dataVersion])
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const cols = buildColumns(apps.data ?? [], jobs.data ?? [])
  const all = cols.flatMap((c) => c.cards)

  const move = async (card: TrackerCard, status: string) => {
    if (status === card.status || busy) return
    setBusy(true); setErr(null)
    try {
      if (card.applicationId !== null) await api.patchApplication(card.applicationId, { status })
      else await api.createApplication(card.jobId, status)
      apps.reload(); jobs.reload(); bumpData()
    } catch (e) { setErr(errMessage(e)) } finally { setBusy(false) }
  }

  const loading = (apps.loading && !apps.data) || (jobs.loading && !jobs.data)
  const error = apps.error ?? jobs.error

  return (
    <>
      <PageHeader title="Tracker" subtitle="Drag cards between columns, or use the status menu on each card."
        actions={<button className="btn btn-primary" onClick={openAddJob}>+ Add job</button>} />
      {err && <p role="alert" className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-800">{err}</p>}
      {loading ? <Spinner /> : error ? <ErrorState error={error} onRetry={() => { apps.reload(); jobs.reload() }} /> : (
        <>
          {all.length === 0 && (
            <div className="mb-4"><EmptyState title="Nothing to track yet" action={<button className="btn btn-primary" onClick={openAddJob}>Add a job</button>}>
              Save a job or start an application and it will appear here. High-match jobs (70+) you have not acted on show up under Discovered.
            </EmptyState></div>
          )}
          <div className="flex gap-3 overflow-x-auto pb-4" data-testid="kanban">
            {cols.map((col) => (
              <section key={col.status} aria-label={`${col.status}, ${col.cards.length} cards`} data-testid={`column-${col.status}`}
                onDragOver={(e) => { e.preventDefault(); setOverCol(col.status) }}
                onDragLeave={() => setOverCol((c) => (c === col.status ? null : c))}
                onDrop={(e) => { e.preventDefault(); setOverCol(null); const card = all.find((c) => c.key === (dragKey ?? e.dataTransfer.getData('text/plain'))); setDragKey(null); if (card) void move(card, col.status) }}
                className={`w-64 shrink-0 rounded-lg border p-2 ${overCol === col.status ? 'border-accent-600 bg-accent-50' : 'border-slate-200 bg-slate-100'}`}>
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold tracking-wide text-slate-700">
                  <span>{col.status.toUpperCase()}</span><span className="rounded-full bg-white px-1.5 py-0.5 text-slate-600" data-testid={`count-${col.status}`}>{col.cards.length}</span>
                </h2>
                <ul className="grid min-h-[3rem] gap-2">
                  {col.cards.map((c) => (
                    <li key={c.key} draggable data-testid="tracker-card" data-job-id={c.jobId}
                      onDragStart={(e) => { setDragKey(c.key); e.dataTransfer.setData('text/plain', c.key); e.dataTransfer.effectAllowed = 'move' }}
                      onDragEnd={() => { setDragKey(null); setOverCol(null) }}
                      className={`card cursor-grab p-2.5 active:cursor-grabbing ${dragKey === c.key ? 'opacity-50' : ''}`}>
                      <div className="flex items-start gap-2">
                        <MatchRing score={c.score} size={36} testId="card-score" />
                        <div className="min-w-0">
                          <Link to={c.applicationId !== null ? `/jobs/${c.jobId}/workspace` : `/jobs/${c.jobId}`} className="block truncate text-sm font-semibold text-slate-900 hover:underline">{c.title}</Link>
                          <div className="truncate text-xs text-slate-700">{c.company}</div>
                        </div>
                      </div>
                      <div className="mt-1.5 text-xs text-slate-600">{c.deadline ? `Deadline: ${deadlineText(c.deadline)}` : 'No deadline'}</div>
                      {c.nextAction && <div className="mt-0.5 truncate text-xs text-slate-700">Next: {c.nextAction}</div>}
                      <label className="sr-only" htmlFor={`st-${c.key}`}>Status for {c.title}</label>
                      <select id={`st-${c.key}`} className="input mt-2 py-1 text-xs" value={c.status} disabled={busy} onChange={(e) => void move(c, e.target.value)} data-testid="card-status">
                        {STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </li>
                  ))}
                  {col.cards.length === 0 && <li className="px-1 py-3 text-center text-xs text-slate-500">Empty</li>}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  )
}
