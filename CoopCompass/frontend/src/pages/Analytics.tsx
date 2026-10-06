import { api } from '../api'
import { useApp } from '../AppContext'
import { FunnelChart, GapBarChart, WeeklyChart } from '../components/charts'
import { RatesPanel, ratio } from '../components/RatesPanel'
import { Badge, EmptyState, ErrorState, PageHeader, Section, Spinner, StatCard } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { formatMinutes } from '../lib/format'
import { TimeSavedCard } from './Dashboard'

function ListCounts({ title, items }: { title: string; items: { item: string; count: number }[] }) {
  if (!items.length) return null
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-600">{title}</h3>
      <ul className="text-sm text-slate-800">{items.map((i) => <li key={i.item} className="flex justify-between border-b border-slate-100 py-1"><span>{i.item}</span><span className="tabular-nums">{i.count}</span></li>)}</ul>
    </div>
  )
}

export function AnalyticsPage() {
  const { dataVersion } = useApp()
  const an = useAsync(() => api.analytics(), [dataVersion])
  const pm = useAsync(() => api.productMetrics(), [dataVersion])
  const rm = useAsync(() => api.researchMetrics(), [dataVersion])

  if (an.loading && !an.data) return <><PageHeader title="Analytics" /><Spinner /></>
  if (an.error) return <><PageHeader title="Analytics" /><ErrorState error={an.error} onRetry={an.reload} /></>
  const a = an.data
  if (!a) return null

  return (
    <>
      <PageHeader title="Analytics" subtitle="Measured from your own activity. Nothing on this page is estimated or pre-filled." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Jobs added" value={a.summary.jobs_total} />
        <StatCard label="Jobs analyzed" value={a.summary.jobs_analyzed} />
        <StatCard label="Average match score" value={a.summary.avg_match_score === null ? '—' : a.summary.avg_match_score.toFixed(1)} hint={a.summary.avg_match_score === null ? 'No scored jobs yet' : undefined} />
        <StatCard label="Offers" value={a.summary.offers} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Application funnel (distinct jobs)">
          {a.funnel.every((f) => f.count === 0) ? <EmptyState title="Nothing in the funnel yet">Add and analyze jobs to start filling it.</EmptyState> : <FunnelChart funnel={a.funnel} />}
        </Section>
        <Section title="Weekly activity">
          {a.weekly_activity.length ? <WeeklyChart data={a.weekly_activity} /> : <p className="text-sm text-slate-600">No activity recorded yet.</p>}
        </Section>
      </div>

      <Section title="Conversion and performance">
        <RatesPanel a={a} />
      </Section>

      <Section title="Most frequent skill gaps">
        {a.skill_gap_frequency.length === 0 ? <p className="text-sm text-slate-600">No skill gaps recorded yet — analyze jobs against your profile first.</p> : (
          <>
            <GapBarChart data={a.skill_gap_frequency} />
            <p className="mt-2 text-xs text-slate-600">Counts are the number of analyzed jobs where the skill was required or preferred and not found in your profile evidence.</p>
          </>
        )}
      </Section>

      <Section title="Time spent">
        <div className="grid gap-3 sm:grid-cols-3" data-testid="time-spent">
          <StatCard label="Avg. active time per application" value={formatMinutes(a.avg_time_per_application_minutes)} hint={a.avg_time_per_application_minutes === null ? 'Not enough tracked time yet' : undefined} />
          <StatCard label="Median job evaluation" value={formatMinutes(pm.data?.median_job_evaluation_time_minutes)} />
          <StatCard label="Median application preparation" value={formatMinutes(pm.data?.median_application_preparation_time_minutes)} />
        </div>
        {pm.data && (
          <p className="mt-3 text-xs text-slate-600">
            Resume suggestions accepted: {pm.data.resume_suggestion_acceptance_rate === null ? 'not enough data' : `${Math.round(pm.data.resume_suggestion_acceptance_rate <= 1 ? pm.data.resume_suggestion_acceptance_rate * 100 : pm.data.resume_suggestion_acceptance_rate)}%`}.
            {' '}Application → interview: {pm.data.application_to_interview_rate === null ? 'not enough data' : `${Math.round(pm.data.application_to_interview_rate <= 1 ? pm.data.application_to_interview_rate * 100 : pm.data.application_to_interview_rate)}%`}.
            {' '}Applications started: {pm.data.applications_started}; completed: {pm.data.applications_completed}.
          </p>
        )}
        {pm.error && <div className="mt-3"><ErrorState error={pm.error} onRetry={pm.reload} /></div>}
      </Section>

      {pm.data && <TimeSavedCard pm={pm.data} />}
      {pm.data && pm.data.observations_with_baseline === 0 && (
        <p className="mb-5 text-xs text-slate-600">Time-saved estimates appear only after you record how long an application would normally have taken you (n = 0 so far).</p>
      )}

      <Section title="What we’ve learned">
        <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="learning">
          <Badge tone={a.learning.stage === 'collecting' ? 'amber' : 'green'}>Stage: {a.learning.stage.replace(/_/g, ' ')}</Badge>
          <span className="text-xs text-slate-600">{a.learning.outcomes_recorded} outcomes recorded (denominator for any rate: {ratio(a.conversion.interview_rate.numerator, a.conversion.interview_rate.denominator) === '—' ? 'none yet' : `${a.conversion.interview_rate.denominator} applications`})</span>
        </div>
        <p className="text-sm text-slate-800">{a.learning.message}</p>
        {a.insights.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-800" data-testid="insights">{a.insights.map((i, k) => <li key={k}>{i}</li>)}</ul>}
      </Section>

      {rm.data && (
        <Section title="Research survey (aggregate)">
          <p className="text-sm text-slate-800" data-testid="research-message">{rm.data.message}</p>
          {rm.data.status === 'ok' && (
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <ListCounts title="TOP PAIN POINTS" items={rm.data.top_pain_points} />
              <ListCounts title="MOST USED TOOLS" items={rm.data.most_used_tools} />
              <ListCounts title="FEATURE PREFERENCES" items={rm.data.feature_preferences} />
            </div>
          )}
          <p className="mt-2 text-xs text-slate-600">Respondents: {rm.data.respondent_count}.{rm.data.median_weekly_search_hours !== null ? ` Median weekly search hours: ${rm.data.median_weekly_search_hours}.` : ''}{rm.data.mean_minutes_per_application !== null ? ` Mean minutes per application: ${rm.data.mean_minutes_per_application}.` : ''}</p>
        </Section>
      )}
    </>
  )
}
