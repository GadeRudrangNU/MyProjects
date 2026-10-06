import type {
  AiUsage, Analytics, Application, ApplicationPatch, CsvImportResult, DeleteResult, Draft, DraftKind, GapAnalysis,
  Health, Job, JobQuery, MatchResult, NewJob, ProductMetrics, Profile, ProfileInput, ResearchMetrics,
  ResumeUploadResult, Suggestion, SuggestionStatus, Tailoring, TimeKind, UserState, Weights,
} from './types'

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
  get unreachable() { return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504 }
}

function parseDetail(body: unknown, fallback: string): { message: string; code?: string } {
  const d = (body as { detail?: unknown } | null)?.detail
  if (typeof d === 'string') return { message: d }
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const o = d as { code?: string; message?: string }
    return { message: o.message ?? fallback, code: o.code }
  }
  if (Array.isArray(d)) return { message: d.map((x) => (x as { msg?: string }).msg ?? '').filter(Boolean).join('; ') || fallback }
  return { message: fallback }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError(0, "Can't reach the backend.")
  }
  if (!res.ok) {
    let body: unknown = null
    try { body = await res.json() } catch {}
    const { message, code } = parseDetail(body, `Request failed (${res.status})`)
    throw new ApiError(res.status, message, code)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export function weightsParam(w: Weights): string {
  return Object.entries(w).map(([k, v]) => `${k}:${v}`).join(',')
}

export const api = {
  health: () => request<Health>('/health'),
  aiUsage: () => request<AiUsage>('/ai-usage'),

  getProfile: () => request<Profile>('/profile'),
  saveProfile: (p: ProfileInput) => request<Profile>('/profile', json('POST', p)),
  uploadResume: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<ResumeUploadResult>('/resume/upload', { method: 'POST', body: fd })
  },

  listJobs: (q: JobQuery = {}) => request<Job[]>(`/jobs${buildQuery({ ...q })}`),
  getJob: (id: number) => request<Job>(`/jobs/${id}`),
  addJob: (j: NewJob) => request<Job>('/jobs', json('POST', j)),
  addJobFromUrl: (url: string) => request<Job>('/jobs/from-url', json('POST', { url })),
  importCsv: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<CsvImportResult>('/jobs/import-csv', { method: 'POST', body: fd })
  },
  setUserState: (id: number, user_state: UserState) => request<Job>(`/jobs/${id}`, json('PATCH', { user_state })),

  analyze: (id: number) => request<MatchResult>(`/jobs/${id}/analyze`, { method: 'POST' }),
  getMatch: (id: number, weights?: Weights) =>
    request<MatchResult>(`/jobs/${id}/match${buildQuery({ weights: weights ? weightsParam(weights) : undefined })}`),
  gapAnalysis: (id: number) => request<GapAnalysis>(`/jobs/${id}/gap-analysis`),

  tailor: (id: number) => request<Tailoring>(`/jobs/${id}/tailor`, { method: 'POST' }),
  getTailoring: (id: number) => request<Tailoring | null>(`/jobs/${id}/tailor`),
  setSuggestion: (gid: number, index: number, status: SuggestionStatus) =>
    request<Suggestion>(`/generations/${gid}/suggestions/${index}`, json('PATCH', { status })),

  createDraft: (id: number, kind: DraftKind, question?: string, force?: boolean) =>
    request<Draft>(`/jobs/${id}/draft`, json('POST', { kind, question: question || undefined, force })),
  listDrafts: (id: number) => request<Draft[]>(`/jobs/${id}/drafts`),

  createApplication: (job_id: number, status?: string) => request<Application>('/applications', json('POST', { job_id, status })),
  patchApplication: (id: number, patch: ApplicationPatch) => request<Application>(`/applications/${id}`, json('PATCH', patch)),
  listApplications: (status?: string) => request<Application[]>(`/applications${buildQuery({ status })}`),

  analytics: () => request<Analytics>('/analytics'),
  productMetrics: () => request<ProductMetrics>('/product-metrics'),
  researchMetrics: () => request<ResearchMetrics>('/research-metrics'),

  deleteAll: () => request<DeleteResult>('/data?confirm=true', { method: 'DELETE' }),
}

export interface TimePayload { job_id: number; application_id?: number | null; kind: TimeKind; seconds: number }

export function sendTimeRecord(p: TimePayload): void {
  const body = JSON.stringify({ ...p, application_id: p.application_id ?? undefined })
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon('/api/time-records', new Blob([body], { type: 'application/json' }))) return
    }
    void fetch('/api/time-records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch {}
}

export function sendSessionEvent(name: 'session_start' | 'session_end'): void {
  const body = JSON.stringify({ name })
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'application/json' }))) return
    void fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch {}
}
