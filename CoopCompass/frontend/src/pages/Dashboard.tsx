import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../AppContext'
import { FunnelChart, WeeklyChart } from '../components/charts'
import { JobCard } from '../components/JobCard'
import { Badge, EmptyState, ErrorState, PageHeader, Section, Spinner, StatCard } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { deadlineText, formatDate, formatMinutes } from '../lib/format'
import type { ProductMetrics } from '../types'

export function TimeSavedCard({ pm }: { pm: ProductMetrics }) {
  if (pm.observations_with_baseline <= 0) return null
  return (
    <Section title="Time saved (self-reported)">
      <div data-testid="time-saved">
        <div className="text-2xl font-semibold text-slate-900">
          {pm.median_time_saved_minutes !== null ? `${formatMinutes(pm.median_time_saved_minutes)} median per application` : 'Not computable yet'}
        </div>
        <p className="mt-1 text-sm text-slate-700">
          n = {pm.observations_with_baseline} self-reported observations; {pm.claimable
            ? 'meets the claim threshold.'
            : `not claimable until n >= ${pm.claim_threshold}.`}
        </p>
        <div className="mt-2"><Badge tone={pm.claimable ? 'green' : 'amber'}>{pm.claimable ? '✓ Claimable' : '△ Not claimable yet'}</Badge></div>
        {pm.median_baseline_minutes !== null && pm.median_assisted_minutes !== null && (
          <p className="mt-2 text-xs text-slate-600">Median baseline {formatMinutes(pm.median_baseline_minutes)} vs. median with CoopCompass {formatMinutes(pm.median_assisted_minutes)}.</p>
        )}
      </div>
    </Section>
  )
}

export function DashboardPage() {
  const { profile, profileLoaded, openAddJob, dataVersion } = useApp()
  const analytics = useAsync(() => api.analytics(), [dataVersion])
  const jobs = useAsync(() => api.listJobs({ sort: 'best_match' }), [dataVersion])
  const pm = useAsync(() => api.productMetrics(), [dataVersion])

  const noProfile = profileLoaded && profile && !profile.exists
  const a = analytics.data
  const recommended = (jobs.data ?? []).filter((j) => j.user_state !== 'ignored' && j.match_score !== null).slice(0, 5)

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Your search at a glance. Nothing here is submitted for you."
        actions={<button className="btn btn-primary" onClick={openAddJob}>+ Add job</button>} />

      {noProfile && (
        <div className="card mb-5 border-accent-100 bg-accent-50 p-5" data-testid="onboarding-card">
          <h2 className="text-base font-semibold text-slate-900">Create your profile to rank jobs</h2>
          <p className="mt-1 text-sm text-slate-700">Match scores are computed from your own skills and evidence — so we need those first.</p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-800">
            <li>Upload your resume or fill in your profile (nothing is saved until you review it).</li>
            <li>Add or import job postings.</li>
            <li>Review ranked matches and the evidence behind each score.</li>
          </ol>
          <Link to="/profile" className="btn btn-primary mt-4">Create profile</Link>
        </div>
      )}

      {analytics.loading && !a ? <Spinner /> : analytics.error ? <ErrorState error={analytics.error} onRetry={analytics.reload} /> : a && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="stat-cards">
            <StatCard label="Jobs analyzed" value={a.summary.jobs_analyzed} hint={`of ${a.summary.jobs_total} added`} testId="stat-analyzed" />
            <StatCard label="High-match opportunities" value={a.summary.high_match_jobs} testId="stat-high" />
            <StatCard label="In progress" value={a.summary.applications_in_progress} testId="stat-progress" />
            <StatCard label="Submitted" value={a.summary.applications_submitted} testId="stat-submitted" />
            <StatCard label="Interviews" value={a.summary.interviews} testId="stat-interviews" />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section title="Recommended opportunities" actions={<Link to="/jobs" className="text-sm text-accent-700 hover:underline">View all</Link>}>
                {jobs.loading && !jobs.data ? <Spinner /> : jobs.error ? <ErrorState error={jobs.error} onRetry={jobs.reload} /> : recommended.length === 0 ? (
                  <EmptyState title="No ranked jobs yet" action={<button className="btn btn-primary" onClick={openAddJob}>Add a job</button>}>
                    {noProfile ? 'Create your profile and add jobs to see ranked recommendations here.' : 'Add a job posting and it will be scored against your profile.'}
                  </EmptyState>
                ) : (
                  <div className="grid gap-3" data-testid="recommended">{recommended.map((j) => <JobCard key={j.id} job={j} compact />)}</div>
                )}
              </Section>
              <Section title="Weekly activity (last 8 weeks)">
                {a.weekly_activity.length === 0 ? <EmptyState title="No activity yet">Activity appears here once you analyze jobs or start applications.</EmptyState> : <WeeklyChart data={a.weekly_activity} />}
              </Section>
            </div>
            <div>
              <Section title="Application funnel">
                {a.funnel.every((f) => f.count === 0) ? <EmptyState title="Nothing in the funnel yet">Add and analyze jobs to start filling it.</EmptyState> : <FunnelChart funnel={a.funnel} />}
              </Section>
              <Section title="Upcoming deadlines">
                {a.summary.upcoming_deadlines.length === 0 ? <p className="text-sm text-slate-600">No upcoming deadlines.</p> : (
                  <ul className="divide-y divide-slate-100" data-testid="deadlines">
                    {a.summary.upcoming_deadlines.map((d) => (
                      <li key={`${d.job_id}-${d.deadline}`} className="py-2 text-sm">
                        <Link to={`/jobs/${d.job_id}`} className="font-medium text-slate-900 hover:underline">{d.title}</Link>
                        <div className="text-xs text-slate-600">{d.company} · {formatDate(d.deadline)} · <span className={d.days_left <= 3 ? 'font-semibold text-red-700' : ''}>{deadlineText(d.deadline)}</span>{d.status ? ` · ${d.status}` : ''}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              {pm.data && <TimeSavedCard pm={pm.data} />}
            </div>
          </div>
        </>
      )}
    </>
  )
}
