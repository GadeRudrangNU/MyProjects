import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { daysUntil, deadlineText, errMessage, formatDate } from '../lib/format'
import type { Job, UserState } from '../types'
import { MatchRing } from './MatchRing'
import { Badge, EvidenceChip, StatusBadge } from './ui'

export function JobCard({ job, onChange, compact }: { job: Job; onChange?: (j: Job) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dl = daysUntil(job.application_deadline)
  const urgent = dl !== null && dl >= 0 && dl <= 7

  const setState = async (s: UserState) => {
    setBusy(true); setErr(null)
    try { onChange?.(await api.setUserState(job.id, job.user_state === s ? 'new' : s)) }
    catch (e) { setErr(errMessage(e)) } finally { setBusy(false) }
  }

  return (
    <article className={`card flex gap-3 p-4 ${job.user_state === 'ignored' ? 'opacity-60' : ''}`} data-testid="job-card" data-job-id={job.id}>
      <MatchRing score={job.match_score} lowEvidence={job.match_summary?.low_evidence} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900">
              <Link to={`/jobs/${job.id}`} className="hover:underline focus-visible:underline" data-testid="job-card-link">{job.title}</Link>
            </h3>
            <p className="truncate text-sm text-slate-700">{job.company}{job.location ? ` · ${job.location}` : ''}{job.is_remote ? ' · Remote' : ''}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {job.employment_type && <Badge tone="slate">{job.employment_type}</Badge>}
            {job.application_status ? <StatusBadge status={job.application_status} /> : job.user_state === 'saved' ? <Badge tone="indigo">Saved</Badge> : job.user_state === 'ignored' ? <Badge>Ignored</Badge> : null}
          </div>
        </div>

        {!compact && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {job.match_summary?.top_strengths.slice(0, 4).map((s) => <EvidenceChip key={s} kind="strong">{s}</EvidenceChip>)}
            {job.match_summary && job.match_summary.gap_count > 0 && (
              <EvidenceChip kind="gap">{job.match_summary.gap_count} {job.match_summary.gap_count === 1 ? 'gap' : 'gaps'}</EvidenceChip>
            )}
            {!job.match_summary && <span className="text-xs text-slate-500">Create a profile to see strengths and gaps.</span>}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span className={urgent ? 'font-semibold text-red-700' : ''}>
            {job.application_deadline ? `${urgent ? '! ' : ''}Deadline ${formatDate(job.application_deadline)} (${deadlineText(job.application_deadline)})` : 'No deadline listed'}
          </span>
          {onChange && (
            <span className="flex gap-1.5">
              <button className="btn btn-sm" disabled={busy} aria-pressed={job.user_state === 'saved'} onClick={() => void setState('saved')} data-testid="save-job">
                {job.user_state === 'saved' ? '★ Saved' : '☆ Save'}
              </button>
              <button className="btn btn-sm" disabled={busy} aria-pressed={job.user_state === 'ignored'} onClick={() => void setState('ignored')} data-testid="ignore-job">
                {job.user_state === 'ignored' ? 'Unignore' : 'Ignore'}
              </button>
            </span>
          )}
        </div>
        {err && <p role="alert" className="mt-1 text-xs text-red-700">{err}</p>}
      </div>
    </article>
  )
}
