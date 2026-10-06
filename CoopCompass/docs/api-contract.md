# CoopCompass API contract (v0.1)

Base path `/api`. JSON everywhere. Single local user (no auth). Errors: `{"detail": ...}` (FastAPI default); coded errors use `{"detail": {"code": "...", "message": "..."}}`.
Dates are ISO-8601 strings. Any number that cannot be computed from real data is `null` (never a fabricated default).

## Health
`GET /api/health` -> `{status:"ok", ai_provider:"gemini"|"local", ai_available:boolean, embedding_backend:"sentence-transformers"|"tfidf", demo_data:boolean}`

`GET /api/ai-usage` -> `{provider, ai_available, requests_today, daily_limit, cached_generations}`

## Profile
```ts
type Evidence = { id: string; section: "Experience"|"Projects"|"Education"|"Skills"|"Other"; text: string; skills: string[] }
type Education = { degree: string; field: string; school: string; status: "completed"|"in_progress"; year: string }
type Weights = { skills:number; experience:number; role:number; education:number; location:number; preferences:number } // normalised to sum 100
type Profile = {
  exists: boolean            // false => defaults, nothing saved yet
  name: string; headline: string
  target_roles: string[]; skills: string[]; experience_months: number
  education: Education[]
  preferred_locations: string[]
  remote_preference: "any"|"remote"|"hybrid"|"onsite"
  employment_types: string[]  // "co-op" | "internship" | "full-time" | "part-time" | "contract"
  industries: string[]; work_authorization: string
  requires_sponsorship: boolean|null
  preferred_technologies: string[]; salary_min: number|null
  evidence_items: Evidence[]
  match_weights: Weights
  resume_id: number|null
}
```
- `GET /api/profile` -> Profile
- `POST /api/profile` (body: Profile without `exists`) -> Profile (upsert; first save emits `profile_created`)
- `POST /api/resume/upload` multipart field `file` (.pdf/.docx/.txt) ->
  `{resume_id:number, filename:string, char_count:number, warnings:string[], draft:{skills:string[], technologies:string[], experience_months:number, education:Education[], evidence_items:Evidence[], projects:{name:string,text:string}[]}}`
  **The draft is NOT saved to the profile.** UI must show it for review/edit and the user saves via `POST /api/profile` (include `resume_id`).

## Jobs
```ts
type Job = {
  id:number; company:string; title:string; location:string|null; employment_type:string|null
  salary_text:string|null; required_skills:string[]; preferred_skills:string[]
  minimum_experience_years:number|null; education:string|null
  responsibilities:string[]; keywords:string[]; work_authorization_notes:string[]
  posting_url:string|null; date_added:string; application_deadline:string|null
  raw_description?:string        // only on GET /api/jobs/{id}
  source:"manual"|"url"|"csv"|"demo_seed"; parse_notes:string[]; is_remote:boolean
  user_state:"new"|"saved"|"ignored"
  application_id:number|null; application_status:string|null
  match_score:number|null        // 0-100, null if no profile yet
  match_summary:{top_strengths:string[]; gap_count:number}|null
}
```
- `POST /api/jobs` `{company, title, location?, description, posting_url?, employment_type?, application_deadline?}` -> Job (parsed/normalised; duplicates return the existing job)
- `POST /api/jobs/from-url` `{url}` -> Job, or 422 `{code:"extraction_failed", message}` (UI then offers manual paste)
- `POST /api/jobs/import-csv` multipart `file` -> `{imported:number, skipped_duplicates:number, errors:string[]}`
- `GET /api/jobs` query: `q, role, location, company, status(user_state), application_status, min_score, remote(bool), sort = best_match|newest|deadline|status` -> Job[] (no raw_description)
- `GET /api/jobs/{id}` -> Job (with raw_description)
- `PATCH /api/jobs/{id}` `{user_state}` -> Job. Setting `saved` also creates an application with status `Saved` if none exists.

## Matching (deterministic; the LLM never produces the score)
```ts
type EvidenceRef = { id:string; section:string; text:string; source:"experience"|"project"|"skills_list"|"education"|"other" }
type MatchResult = {
  job_id:number; overall:number            // 0-100, 1 decimal, = sum of breakdown points
  weights:Weights
  breakdown:{key:"skills"|"experience"|"role"|"education"|"location"|"preferences"; label:string; weight:number; points:number; fraction:number; detail:string}[]
  strong:{skill:string; kind:"required"|"preferred"; evidence:EvidenceRef[]}[]
  partial:{skill:string; kind:"required"|"preferred"; reason:string; evidence:EvidenceRef[]}[]
  gaps:{requirement:string; kind:"skill_required"|"skill_preferred"|"experience"|"education"; message:string}[]
  concerns:{type:string; message:string}[]
  embedding_backend:string; computed_at:string
}
```
- `POST /api/jobs/{id}/analyze` -> MatchResult (persists; emits `job_analyzed`)
- `GET /api/jobs/{id}/match` -> MatchResult (no event). Optional query `weights=skills:35,experience:20,...` to preview custom weights without saving.
- Both return 409 `{code:"profile_required"}` if no profile saved.

## Resume gap analysis
`GET /api/jobs/{id}/gap-analysis` ->
```ts
{ job_id:number
  present:{requirement:string; kind:string; evidence:EvidenceRef[]}[]
  weak:{requirement:string; kind:string; reason:string; evidence:EvidenceRef[]}[]
  gaps:{requirement:string; kind:string; message:"No evidence found in current resume."}[]
  responsibilities:{text:string; status:"present"|"weak"|"gap"; similarity:number; best_evidence:EvidenceRef|null}[] }
```

## Resume tailoring (suggestions are grounded in profile evidence; user must accept)
```ts
type Suggestion = { index:number; original:string; suggested:string|null; rationale:string; jd_terms:string[]
  source_evidence:{id:string; section:string; text:string}; status:"pending"|"accepted"|"rejected" }
type Tailoring = { generation_id:number; provider:"gemini"|"local"; cached:boolean; notice:string; suggestions:Suggestion[] }
```
`suggested` is `null` in local mode (local mode only recommends *which* bullets to lead with and which JD terms they already substantiate).
- `POST /api/jobs/{id}/tailor` -> Tailoring (emits `resume_suggestion_generated`)
- `GET /api/jobs/{id}/tailor` -> Tailoring | null
- `PATCH /api/generations/{generation_id}/suggestions/{index}` `{status:"accepted"|"rejected"|"pending"}` -> Suggestion (accepted emits `resume_suggestion_accepted`)

## Drafts
`POST /api/jobs/{id}/draft` `{kind:"cover_letter"|"short_answer"|"recruiter_outreach"|"networking", question?:string, force?:boolean}` ->
`{generation_id, kind, provider:"gemini"|"local", cached:boolean, is_template:boolean, text:string, facts_used:string[], disclaimer:"AI GENERATED — REVIEW BEFORE USING"|"TEMPLATE DRAFT — REVIEW AND EDIT BEFORE USING"}`
`GET /api/jobs/{id}/drafts` -> same objects[] (latest first)

## Applications / tracker
Statuses (ordered): `Discovered, Saved, Preparing, Applied, Assessment, Interview, Offer, Rejected, Withdrawn`.
```ts
type Application = { id:number; job_id:number; company:string; title:string; status:string
  resume_version:string|null; match_score:number|null; date_discovered:string; date_applied:string|null
  notes:string; next_action:string; deadline:string|null
  checklist:{id:string; label:string; done:boolean}[]
  baseline_minutes:number|null     // user's optional "how long would this normally take"
  assisted_minutes:number          // sum of tracked CoopCompass time for this job
  history:{from_status:string|null; to_status:string; at:string}[]
  created_at:string; updated_at:string }
```
- `POST /api/applications` `{job_id, status?="Preparing"}` -> Application (idempotent per job: returns/updates the existing one). `Preparing` emits `application_started`.
- `PATCH /api/applications/{id}` any of `{status, notes, next_action, deadline, resume_version, checklist, baseline_minutes, date_applied}` -> Application (status change records history + `status_changed`; `Applied` -> `application_marked_applied`; `Interview` -> `interview_received`; `Offer` -> `offer_received`)
- `GET /api/applications?status=` -> Application[]

## Time + events
- `POST /api/time-records` `{job_id, application_id?, kind:"job_analysis"|"resume_tailoring"|"application_preparation", seconds:number}` -> `{id}`. The UI measures *active* time on the page (pause when tab hidden / idle) and posts on page leave (use `navigator.sendBeacon` or `fetch keepalive`).
- `POST /api/events` `{name, job_id?, application_id?, properties?:object}` -> `{id}`. Allowed UI names: `session_start, session_end, job_added, job_saved, resume_uploaded, ...` (server validates against a whitelist). Frontend must send `session_start` on app load and `session_end` on unload.

## Analytics (real data only)
`GET /api/analytics` ->
```ts
{ summary:{jobs_total:number; jobs_analyzed:number; high_match_jobs:number; applications_in_progress:number; applications_submitted:number; interviews:number; offers:number; avg_match_score:number|null
           upcoming_deadlines:{job_id:number; application_id:number|null; company:string; title:string; deadline:string; days_left:number; status:string|null}[]}
  weekly_activity:{week_start:string; applications_started:number; applications_submitted:number; jobs_analyzed:number}[]   // last 8 weeks
  funnel:{stage:string; label:string; count:number}[]   // Job Added > Analyzed > Saved > Application Started > Applied > Interview (distinct jobs, from analytics_events)
  sufficient_data:boolean; min_applications_for_rates:number; insufficient_message:"Not enough application history yet."
  conversion:{applied:number; assessment_rate:Rate; interview_rate:Rate; interview_to_offer_rate:Rate}      // Rate = {numerator:number; denominator:number; rate:number|null}
  avg_time_per_application_minutes:number|null
  fit_conversion:{threshold:number; high_fit:{applications:number; interviews:number; rate:number|null}; low_fit:{applications:number; interviews:number; rate:number|null}}
  role_performance:{role:string; applications:number; interviews:number; offers:number}[]
  score_bands:{band:string; applications:number; interviews:number}[]
  resume_version_performance:{version:string; applications:number; interviews:number}[]
  skill_gap_frequency:{skill:string; count:number; share:number}[]
  insights:string[]; learning:{stage:"collecting"|"descriptive"|"calibration_possible"; outcomes_recorded:number; message:string} }
```
When `sufficient_data` is false the UI shows `insufficient_message` instead of rates/charts that need history. NEVER substitute fake numbers.

`GET /api/product-metrics` ->
```ts
{ generated_at:string; real_users:number; research_participants:number; jobs_analyzed:number; applications_started:number; applications_completed:number
  median_job_evaluation_time_minutes:number|null; median_application_preparation_time_minutes:number|null
  median_baseline_minutes:number|null; median_assisted_minutes:number|null; median_time_saved_minutes:number|null; median_time_reduction_pct:number|null
  observations_with_baseline:number; claim_threshold:number; claimable:boolean
  resume_suggestion_acceptance_rate:number|null; application_to_interview_rate:number|null; weekly_estimated_time_saved_minutes:number|null; notes:string[] }
```
Show time-saved in the UI only when `observations_with_baseline > 0`, and label it "n = X self-reported observations; not claimable until X >= claim_threshold" when `claimable` is false.

`GET /api/research-metrics` -> `{status:"collection_in_progress"|"ok"; message:string; respondent_count:number; median_weekly_search_hours:number|null; mean_minutes_per_application:number|null; top_pain_points:{item:string;count:number}[]; most_used_tools:{item:string;count:number}[]; feature_preferences:{item:string;count:number}[]}`

## Data deletion
`DELETE /api/data?confirm=true` -> `{deleted:{profile:number; resumes:number; applications:number; events:number; generations:number; time_records:number; job_matches:number; jobs:number}}`
