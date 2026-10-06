import { STATUSES, type Application, type Job } from '../types'

export interface TrackerCard {
  key: string
  jobId: number
  applicationId: number | null
  company: string
  title: string
  score: number | null
  deadline: string | null
  nextAction: string
  status: string
}

export const DISCOVERED_MIN_SCORE = 70
export const DISCOVERED_LIMIT = 10

export function buildColumns(apps: Application[], jobs: Job[]): { status: string; cards: TrackerCard[] }[] {
  const cols = new Map<string, TrackerCard[]>(STATUSES.map((s) => [s, []]))
  for (const a of apps) {
    const status = cols.has(a.status) ? a.status : 'Discovered'
    cols.get(status)!.push({
      key: `a${a.id}`, jobId: a.job_id, applicationId: a.id, company: a.company, title: a.title,
      score: a.match_score, deadline: a.deadline, nextAction: a.next_action, status,
    })
  }
  const known = new Set(apps.map((a) => a.job_id))
  const suggested = jobs
    .filter((j) => j.user_state === 'new' && j.application_id === null && !known.has(j.id) && j.match_score !== null && j.match_score >= DISCOVERED_MIN_SCORE)
    .sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0))
    .slice(0, DISCOVERED_LIMIT)
  for (const j of suggested) {
    cols.get('Discovered')!.push({
      key: `j${j.id}`, jobId: j.id, applicationId: null, company: j.company, title: j.title,
      score: j.match_score, deadline: j.application_deadline, nextAction: '', status: 'Discovered',
    })
  }
  return STATUSES.map((s) => ({ status: s, cards: cols.get(s)! }))
}
