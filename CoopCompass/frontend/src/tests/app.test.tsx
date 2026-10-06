import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MatchRing } from '../components/MatchRing'
import { RatesPanel } from '../components/RatesPanel'
import { ActiveTimeCounter, IDLE_LIMIT_MS } from '../lib/activeTime'
import { formatScore, normaliseWeights, scoreTone } from '../lib/format'
import { buildColumns } from '../lib/tracker'
import { TimeSavedCard } from '../pages/Dashboard'
import { STATUSES, type Analytics, type Application, type Job, type ProductMetrics } from '../types'

const sendTimeRecord = vi.fn()
vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), sendTimeRecord: (p: unknown) => sendTimeRecord(p) }))
import { useActiveTime } from '../hooks/useActiveTime'

describe('score formatting and MatchRing', () => {
  it('rounds scores and never shows null as 0', () => {
    expect(formatScore(82.4)).toBe('82')
    expect(formatScore(null)).toBe('–')
    expect(scoreTone(null)).toBe('none')
    expect(scoreTone(70)).toBe('high')
    expect(scoreTone(55)).toBe('mid')
    expect(scoreTone(12)).toBe('low')
  })
  it('renders value and an accessible label', () => {
    render(<MatchRing score={82.4} />)
    expect(screen.getByTestId('match-score-value')).toHaveTextContent('82')
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('Strong match'))
  })
  it('renders an unscored ring for null', () => {
    render(<MatchRing score={null} />)
    expect(screen.getByTestId('match-score-value')).toHaveTextContent('–')
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Match score not available')
  })
  it('normalises weights to 100', () => {
    const n = normaliseWeights({ a: 1, b: 1 })
    expect(n.a + n.b).toBe(100)
  })
})

describe('ActiveTimeCounter', () => {
  it('counts only visible, recently-interacted seconds', () => {
    const c = new ActiveTimeCounter(0)
    expect(c.tick(1000)).toBe(true)
    c.visible = false
    expect(c.tick(2000)).toBe(false)
    c.visible = true
    expect(c.tick(IDLE_LIMIT_MS + 1)).toBe(false) // idle > 60s
    c.interact(IDLE_LIMIT_MS + 2)
    expect(c.tick(IDLE_LIMIT_MS + 3)).toBe(true)
    expect(c.pendingSeconds).toBe(2)
  })
  it('does not flush fewer than 3 seconds', () => {
    const c = new ActiveTimeCounter(0)
    c.tick(1); c.tick(2)
    expect(c.take()).toBe(0)
    c.tick(3)
    expect(c.take()).toBe(3)
    expect(c.pendingSeconds).toBe(0)
  })
})

describe('useActiveTime', () => {
  beforeEach(() => { vi.useFakeTimers(); sendTimeRecord.mockClear() })
  it('posts accumulated seconds on unmount, with the right kind', () => {
    const { unmount } = renderHook(() => useActiveTime('resume_tailoring', 7, 3))
    act(() => { vi.advanceTimersByTime(5000) })
    unmount()
    expect(sendTimeRecord).toHaveBeenCalledTimes(1)
    expect(sendTimeRecord).toHaveBeenCalledWith({ job_id: 7, application_id: 3, kind: 'resume_tailoring', seconds: 5 })
    vi.useRealTimers()
  })
  it('skips posting when under 3 seconds', () => {
    const { unmount } = renderHook(() => useActiveTime('job_analysis', 7))
    act(() => { vi.advanceTimersByTime(2000) })
    unmount()
    expect(sendTimeRecord).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

const mkApp = (id: number, status: string): Application => ({
  id, job_id: id, company: 'C', title: `T${id}`, status, resume_version: null, match_score: 50, date_discovered: '', date_applied: null,
  notes: '', next_action: '', deadline: null, checklist: [], baseline_minutes: null, assisted_minutes: 0, history: [], created_at: '', updated_at: '',
})
const mkJob = (id: number, score: number | null, over: Partial<Job> = {}): Job => ({
  id, company: 'C', title: `J${id}`, location: null, employment_type: null, salary_text: null, required_skills: [], preferred_skills: [],
  minimum_experience_years: null, education: null, responsibilities: [], keywords: [], work_authorization_notes: [], posting_url: null,
  date_added: '', application_deadline: null, source: 'manual', parse_notes: [], is_remote: false, user_state: 'new', application_id: null,
  application_status: null, match_score: score, match_summary: null, ...over,
})

describe('tracker columns', () => {
  it('keeps the canonical status order', () => {
    const cols = buildColumns([mkApp(1, 'Offer'), mkApp(2, 'Saved')], [])
    expect(cols.map((c) => c.status)).toEqual([...STATUSES])
    expect(cols.find((c) => c.status === 'Offer')!.cards).toHaveLength(1)
  })
  it('builds Discovered from new, unapplied jobs scoring >= 70 (top 10)', () => {
    const jobs = [
      mkJob(1, 90), mkJob(2, 69.9), mkJob(3, null), mkJob(4, 80, { user_state: 'saved' }), mkJob(5, 75, { application_id: 9 }),
      ...Array.from({ length: 12 }, (_, i) => mkJob(100 + i, 70 + i)),
    ]
    const disc = buildColumns([], jobs)[0].cards
    expect(disc).toHaveLength(10)
    expect(disc[0].jobId).toBe(1)
    expect(disc.every((c) => (c.score ?? 0) >= 70 && c.applicationId === null)).toBe(true)
  })
})

const baseAnalytics = (over: Partial<Analytics>): Analytics => ({
  summary: { jobs_total: 0, jobs_analyzed: 0, high_match_jobs: 0, applications_in_progress: 0, applications_submitted: 0, interviews: 0, offers: 0, avg_match_score: null, upcoming_deadlines: [] },
  weekly_activity: [], funnel: [], sufficient_data: false, min_applications_for_rates: 10, insufficient_message: 'Not enough application history yet.',
  conversion: { applied: 0, assessment_rate: { numerator: 0, denominator: 0, rate: null }, interview_rate: { numerator: 0, denominator: 0, rate: null }, interview_to_offer_rate: { numerator: 0, denominator: 0, rate: null } },
  avg_time_per_application_minutes: null,
  fit_conversion: { threshold: 70, high_fit: { applications: 0, interviews: 0, rate: null }, low_fit: { applications: 0, interviews: 0, rate: null } },
  role_performance: [], score_bands: [], resume_version_performance: [], skill_gap_frequency: [], insights: [],
  learning: { stage: 'collecting', outcomes_recorded: 0, message: '' }, ...over,
})

describe('insufficient data', () => {
  it('shows the API message instead of rates', () => {
    render(<RatesPanel a={baseAnalytics({})} />)
    expect(screen.getByTestId('insufficient-data')).toHaveTextContent('Not enough application history yet.')
    expect(screen.queryByTestId('rates')).toBeNull()
  })
  it('shows rates with n / denominator when sufficient', () => {
    const a = baseAnalytics({ sufficient_data: true })
    a.conversion.interview_rate = { numerator: 2, denominator: 8, rate: 0.25 }
    render(<RatesPanel a={a} />)
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('n = 2 of 8')).toBeInTheDocument()
  })
})

describe('time-saved card', () => {
  const pm = { observations_with_baseline: 0, claim_threshold: 30, claimable: false, median_time_saved_minutes: null } as ProductMetrics
  it('renders nothing with no baseline observations', () => {
    const { container } = render(<TimeSavedCard pm={pm} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('labels n and claimable status honestly', () => {
    render(<TimeSavedCard pm={{ ...pm, observations_with_baseline: 3, median_time_saved_minutes: 20, median_baseline_minutes: null, median_assisted_minutes: null }} />)
    expect(screen.getByTestId('time-saved')).toHaveTextContent('n = 3 self-reported observations; not claimable until n >= 30.')
  })
})
