export type Section = 'Experience' | 'Projects' | 'Education' | 'Skills' | 'Other'
export interface Evidence { id: string; section: Section; text: string; skills: string[] }
export interface Education { degree: string; field: string; school: string; status: 'completed' | 'in_progress'; year: string }
export interface Weights { skills: number; experience: number; role: number; education: number; location: number; preferences: number }
export type WeightKey = keyof Weights
export type RemotePref = 'any' | 'remote' | 'hybrid' | 'onsite'

export interface Profile {
  exists: boolean
  name: string
  headline: string
  target_roles: string[]
  skills: string[]
  experience_months: number
  education: Education[]
  preferred_locations: string[]
  remote_preference: RemotePref
  employment_types: string[]
  industries: string[]
  work_authorization: string
  requires_sponsorship: boolean | null
  preferred_technologies: string[]
  salary_min: number | null
  evidence_items: Evidence[]
  match_weights: Weights
  resume_id: number | null
}
export type ProfileInput = Omit<Profile, 'exists'>

export interface ResumeUploadResult {
  resume_id: number
  filename: string
  char_count: number
  warnings: string[]
  draft: {
    skills: string[]
    technologies: string[]
    experience_months: number
    education: Education[]
    evidence_items: Evidence[]
    projects: { name: string; text: string }[]
  }
}

export type UserState = 'new' | 'saved' | 'ignored'
export interface Job {
  id: number; company: string; title: string; location: string | null; employment_type: string | null
  salary_text: string | null; required_skills: string[]; preferred_skills: string[]
  minimum_experience_years: number | null; education: string | null
  responsibilities: string[]; keywords: string[]; work_authorization_notes: string[]
  posting_url: string | null; date_added: string; application_deadline: string | null
  raw_description?: string
  source: 'manual' | 'url' | 'csv' | 'demo_seed'; parse_notes: string[]; is_remote: boolean
  user_state: UserState
  application_id: number | null; application_status: string | null
  match_score: number | null
  match_summary: { top_strengths: string[]; gap_count: number; low_evidence?: boolean } | null
}
export interface NewJob {
  company: string; title: string; location?: string; description: string
  posting_url?: string; employment_type?: string; application_deadline?: string
}
export interface JobQuery {
  q?: string; role?: string; location?: string; company?: string; status?: string
  application_status?: string; min_score?: number; remote?: boolean
  sort?: 'best_match' | 'newest' | 'deadline' | 'status'
}
export interface CsvImportResult { imported: number; skipped_duplicates: number; errors: string[] }

export interface EvidenceRef { id: string; section: string; text: string; source: 'experience' | 'project' | 'skills_list' | 'education' | 'other' }
export interface MatchResult {
  job_id: number; overall: number; weights: Weights
  breakdown: { key: WeightKey; label: string; weight: number; points: number; fraction: number; detail: string }[]
  strong: { skill: string; kind: 'required' | 'preferred'; evidence: EvidenceRef[] }[]
  partial: { skill: string; kind: 'required' | 'preferred'; reason: string; evidence: EvidenceRef[] }[]
  gaps: { requirement: string; kind: 'skill_required' | 'skill_preferred' | 'experience' | 'education'; message: string }[]
  concerns: { type: string; message: string }[]
  low_evidence?: boolean; embedding_backend: string; computed_at: string
}

export interface GapAnalysis {
  job_id: number
  present: { requirement: string; kind: string; evidence: EvidenceRef[] }[]
  weak: { requirement: string; kind: string; reason: string; evidence: EvidenceRef[] }[]
  gaps: { requirement: string; kind: string; message: string }[]
  responsibilities: { text: string; status: 'present' | 'weak' | 'gap'; similarity: number; best_evidence: EvidenceRef | null }[]
}

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected'
export interface Suggestion {
  index: number; original: string; suggested: string | null; rationale: string; jd_terms: string[]
  source_evidence: { id: string; section: string; text: string }; status: SuggestionStatus
}
export interface Tailoring { generation_id: number; provider: 'gemini' | 'local'; cached: boolean; notice: string; suggestions: Suggestion[] }

export type DraftKind = 'cover_letter' | 'short_answer' | 'recruiter_outreach' | 'networking'
export interface Draft {
  generation_id: number; kind: DraftKind; provider: 'gemini' | 'local'; cached: boolean; is_template: boolean
  text: string; facts_used: string[]
  disclaimer: 'AI GENERATED — REVIEW BEFORE USING' | 'TEMPLATE DRAFT — REVIEW AND EDIT BEFORE USING'
}

export const STATUSES = ['Discovered', 'Saved', 'Preparing', 'Applied', 'Assessment', 'Interview', 'Offer', 'Rejected', 'Withdrawn'] as const
export type Status = (typeof STATUSES)[number]
export interface ChecklistItem { id: string; label: string; done: boolean }
export interface Application {
  id: number; job_id: number; company: string; title: string; status: string
  resume_version: string | null; match_score: number | null; date_discovered: string; date_applied: string | null
  notes: string; next_action: string; deadline: string | null
  checklist: ChecklistItem[]; baseline_minutes: number | null; assisted_minutes: number
  history: { from_status: string | null; to_status: string; at: string }[]
  created_at: string; updated_at: string
}
export type ApplicationPatch = Partial<Pick<Application, 'status' | 'notes' | 'next_action' | 'deadline' | 'resume_version' | 'checklist' | 'baseline_minutes' | 'date_applied'>>

export type TimeKind = 'job_analysis' | 'resume_tailoring' | 'application_preparation'

export interface Rate { numerator: number; denominator: number; rate: number | null }
export interface Analytics {
  summary: {
    jobs_total: number; jobs_analyzed: number; high_match_jobs: number; applications_in_progress: number
    applications_submitted: number; interviews: number; offers: number; avg_match_score: number | null
    upcoming_deadlines: { job_id: number; application_id: number | null; company: string; title: string; deadline: string; days_left: number; status: string | null }[]
  }
  weekly_activity: { week_start: string; applications_started: number; applications_submitted: number; jobs_analyzed: number }[]
  funnel: { stage: string; label: string; count: number }[]
  sufficient_data: boolean; min_applications_for_rates: number; insufficient_message: string
  conversion: { applied: number; assessment_rate: Rate; interview_rate: Rate; interview_to_offer_rate: Rate }
  avg_time_per_application_minutes: number | null
  fit_conversion: {
    threshold: number
    high_fit: { applications: number; interviews: number; rate: number | null }
    low_fit: { applications: number; interviews: number; rate: number | null }
  }
  role_performance: { role: string; applications: number; interviews: number; offers: number }[]
  score_bands: { band: string; applications: number; interviews: number }[]
  resume_version_performance: { version: string; applications: number; interviews: number }[]
  skill_gap_frequency: { skill: string; count: number; share: number }[]
  insights: string[]
  learning: { stage: 'collecting' | 'descriptive' | 'calibration_possible'; outcomes_recorded: number; message: string }
}
export interface ProductMetrics {
  generated_at: string; real_users: number; research_participants: number; jobs_analyzed: number
  applications_started: number; applications_completed: number
  median_job_evaluation_time_minutes: number | null; median_application_preparation_time_minutes: number | null
  median_baseline_minutes: number | null; median_assisted_minutes: number | null
  median_time_saved_minutes: number | null; median_time_reduction_pct: number | null
  observations_with_baseline: number; claim_threshold: number; claimable: boolean
  resume_suggestion_acceptance_rate: number | null; application_to_interview_rate: number | null
  weekly_estimated_time_saved_minutes: number | null; notes: string[]
}
export interface ResearchMetrics {
  status: 'collection_in_progress' | 'ok'; message: string; respondent_count: number
  median_weekly_search_hours: number | null; mean_minutes_per_application: number | null
  top_pain_points: { item: string; count: number }[]; most_used_tools: { item: string; count: number }[]
  feature_preferences: { item: string; count: number }[]
}
export interface Health { status: 'ok'; ai_provider: 'gemini' | 'local'; ai_available: boolean; embedding_backend: 'sentence-transformers' | 'tfidf'; demo_data: boolean }
export interface AiUsage { provider: string; ai_available: boolean; requests_today: number; daily_limit: number; cached_generations: number }
export interface DeleteResult { deleted: Record<string, number> }
