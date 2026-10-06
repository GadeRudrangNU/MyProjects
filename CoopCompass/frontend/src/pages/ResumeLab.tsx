import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useApp } from '../AppContext'
import { EmptyState, ErrorState, EvidenceChip, PageHeader, Section, Spinner } from '../components/ui'
import { TailorPanel } from '../components/TailorPanel'
import { useActiveTime } from '../hooks/useActiveTime'
import { useAsync } from '../hooks/useAsync'
import { formatScore } from '../lib/format'
import type { EvidenceRef } from '../types'

function Refs({ items }: { items: EvidenceRef[] }) {
  return <ul className="mt-1 space-y-1">{items.slice(0, 3).map((e) => <li key={e.id} className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700"><b className="text-slate-600">[{e.section}]</b> {e.text}</li>)}</ul>
}

function JobPicker() {
  const nav = useNavigate()
  const { dataVersion, openAddJob } = useApp()
  const jobs = useAsync(() => api.listJobs({ sort: 'best_match' }), [dataVersion])
  return (
    <>
      <PageHeader title="Resume Lab" subtitle="Pick a job to see which requirements your profile evidence already covers." />
      {jobs.loading && !jobs.data ? <Spinner /> : jobs.error ? <ErrorState error={jobs.error} onRetry={jobs.reload} /> : !jobs.data?.length ? (
        <EmptyState title="No jobs to analyze" action={<button className="btn btn-primary" onClick={openAddJob}>Add a job</button>}>Add a job posting first.</EmptyState>
      ) : (
        <div className="card p-4">
          <label className="label" htmlFor="job-pick">Job</label>
          <select id="job-pick" className="input max-w-xl" defaultValue="" onChange={(e) => e.target.value && nav(`/resume-lab/${e.target.value}`)} data-testid="job-picker">
            <option value="" disabled>Select a job…</option>
            {jobs.data.filter((j) => j.user_state !== 'ignored').map((j) => <option key={j.id} value={j.id}>{j.title} — {j.company} (match {formatScore(j.match_score)})</option>)}
          </select>
        </div>
      )}
    </>
  )
}

function Lab({ jobId }: { jobId: number }) {
  const job = useAsync(() => api.getJob(jobId), [jobId])
  const gap = useAsync(() => api.gapAnalysis(jobId), [jobId])
  const seconds = useActiveTime('resume_tailoring', jobId, job.data?.application_id)
  const g = gap.data
  const profileRequired = gap.error instanceof ApiError && gap.error.code === 'profile_required'

  return (
    <>
      <PageHeader title="Resume Lab" subtitle={job.data ? <>{job.data.title} · {job.data.company}</> : undefined}
        actions={<><Link to="/resume-lab" className="btn">Change job</Link><Link to={`/jobs/${jobId}`} className="btn">Job match</Link></>} />
      <p className="-mt-3 mb-4 text-xs text-slate-500" data-testid="time-indicator">Time on this job (this visit): {Math.floor(seconds / 60)} min</p>

      {gap.loading && !g ? <Spinner label="Analyzing your evidence…" /> : profileRequired ? (
        <EmptyState title="Profile required" action={<Link to="/profile" className="btn btn-primary">Go to Profile</Link>}>The gap analysis compares this job with the evidence in your profile.</EmptyState>
      ) : gap.error ? <ErrorState error={gap.error} onRetry={gap.reload} /> : g && (
        <>
          <div className="mb-5 grid gap-4 lg:grid-cols-3" data-testid="gap-columns">
            <section className="card p-4" aria-labelledby="h-present" data-testid="col-present">
              <h2 id="h-present" className="mb-2 text-sm font-semibold text-emerald-900">✓ Evidence already present ({g.present.length})</h2>
              {g.present.length === 0 ? <p className="text-sm text-slate-600">Nothing matched yet.</p> : g.present.map((p) => (
                <div key={p.requirement} className="mb-3"><EvidenceChip kind="strong">{p.requirement}</EvidenceChip><Refs items={p.evidence} /></div>
              ))}
            </section>
            <section className="card p-4" aria-labelledby="h-weak" data-testid="col-weak">
              <h2 id="h-weak" className="mb-2 text-sm font-semibold text-amber-900">△ Present but weak ({g.weak.length})</h2>
              {g.weak.length === 0 ? <p className="text-sm text-slate-600">No weak matches.</p> : g.weak.map((p) => (
                <div key={p.requirement} className="mb-3"><EvidenceChip kind="partial">{p.requirement}</EvidenceChip><p className="mt-0.5 text-xs text-slate-700">{p.reason}</p><Refs items={p.evidence} /></div>
              ))}
            </section>
            <section className="card p-4" aria-labelledby="h-gap" data-testid="col-gaps">
              <h2 id="h-gap" className="mb-2 text-sm font-semibold text-red-900">✕ Genuine gaps ({g.gaps.length})</h2>
              {g.gaps.length === 0 ? <p className="text-sm text-slate-600">No gaps found.</p> : g.gaps.map((p) => (
                <div key={p.requirement} className="mb-3"><EvidenceChip kind="gap">{p.requirement}</EvidenceChip><p className="mt-0.5 text-xs text-slate-700">No evidence found in current resume.</p></div>
              ))}
              {g.gaps.length > 0 && <p className="mt-2 text-xs text-slate-600">Only add these to your resume if they are true. CoopCompass will not invent experience.</p>}
            </section>
          </div>

          <Section title="Responsibilities coverage">
            {g.responsibilities.length === 0 ? <p className="text-sm text-slate-600">No responsibilities were parsed from this posting.</p> : (
              <ul className="divide-y divide-slate-100" data-testid="responsibilities">
                {g.responsibilities.map((r, i) => (
                  <li key={i} className="py-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0"><EvidenceChip kind={r.status === 'present' ? 'strong' : r.status === 'weak' ? 'partial' : 'gap'}>{r.status === 'present' ? 'Covered' : r.status === 'weak' ? 'Weak' : 'Not covered'}</EvidenceChip></span>
                      <span className="text-slate-800">{r.text}</span>
                    </div>
                    {r.best_evidence && <p className="mt-1 pl-1 text-xs text-slate-600">Closest evidence ({r.best_evidence.section}): {r.best_evidence.text}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <Section title="Tailoring suggestions"><TailorPanel jobId={jobId} /></Section>
    </>
  )
}

export function ResumeLabPage() {
  const { jobId } = useParams()
  if (!jobId) return <JobPicker />
  const n = Number(jobId)
  if (Number.isNaN(n)) return <EmptyState title="Invalid job" />
  return <Lab jobId={n} />
}
