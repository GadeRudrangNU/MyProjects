import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useApp } from '../AppContext'
import { MatchRing } from '../components/MatchRing'
import { Badge, EmptyState, ErrorState, EvidenceChip, Modal, PageHeader, Section, Spinner, StatusBadge } from '../components/ui'
import { useAsync, useDebounced } from '../hooks/useAsync'
import { useActiveTime } from '../hooks/useActiveTime'
import { deadlineText, errMessage, formatDate, normaliseWeights } from '../lib/format'
import type { EvidenceRef, Job, MatchResult, ProfileInput, UserState, WeightKey, Weights } from '../types'

const WEIGHT_KEYS: WeightKey[] = ['skills', 'experience', 'role', 'education', 'location', 'preferences']

function EvidenceList({ items }: { items: EvidenceRef[] }) {
  if (!items.length) return null
  return (
    <ul className="mt-1 space-y-1">
      {items.map((e) => (
        <li key={e.id} className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
          <span className="mr-1 font-semibold text-slate-600">[{e.section}]</span>{e.text}
        </li>
      ))}
    </ul>
  )
}

function WeightsEditor({ jobId, base, onPreview, onSaved }: { jobId: number; base: Weights; onPreview: (m: MatchResult | null) => void; onSaved: () => void }) {
  const { profile, refreshProfile } = useApp()
  const [w, setW] = useState<Weights>(base)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dw = useDebounced(w, 300)
  const changed = WEIGHT_KEYS.some((k) => Math.abs(w[k] - base[k]) > 0.05)
  const norm = normaliseWeights(w)
  const sum = WEIGHT_KEYS.reduce((a, k) => a + w[k], 0)

  useEffect(() => {
    if (!WEIGHT_KEYS.some((k) => Math.abs(dw[k] - base[k]) > 0.05) || sum <= 0) { onPreview(null); return }
    let cancel = false
    api.getMatch(jobId, normaliseWeights(dw)).then((m) => { if (!cancel) onPreview(m) }).catch((e) => { if (!cancel) setMsg(errMessage(e)) })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dw, jobId])

  const save = async () => {
    if (!profile?.exists) return
    setBusy(true); setMsg(null)
    try {
      const { exists: _exists, ...rest } = profile
      void _exists
      const input: ProfileInput = { ...rest, match_weights: norm }
      await api.saveProfile(input)
      await refreshProfile()
      onPreview(null); onSaved(); setMsg('Saved to your profile. Scores across all jobs now use these weights.')
    } catch (e) { setMsg(errMessage(e)) } finally { setBusy(false) }
  }

  return (
    <details className="mt-4 rounded-md border border-slate-200 p-3" data-testid="weights-editor">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">Adjust factor weights (preview)</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {WEIGHT_KEYS.map((k) => (
          <div key={k}>
            <label className="label capitalize" htmlFor={`w-${k}`}>{k}: {norm[k]}</label>
            <input id={`w-${k}`} type="range" min={0} max={100} value={w[k]} className="w-full accent-accent-600" onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-600">Weights are normalised to sum to 100 (currently {sum > 0 ? '100' : '0 — set at least one weight'}). The preview uses the same deterministic scorer.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn btn-sm" onClick={() => { setW(base); onPreview(null) }} disabled={!changed}>Reset</button>
        <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={!changed || busy || sum <= 0 || !profile?.exists}>Save to profile</button>
      </div>
      {msg && <p role="status" className="mt-2 text-xs text-slate-700">{msg}</p>}
    </details>
  )
}

export function JobMatchPage() {
  const id = Number(useParams().id)
  const nav = useNavigate()
  const { bumpData } = useApp()
  const jobQ = useAsync(() => api.getJob(id), [id])
  const [job, setJob] = useState<Job | null>(null)
  const [match, setMatch] = useState<MatchResult | null>(null)
  const [preview, setPreview] = useState<MatchResult | null>(null)
  const [matchErr, setMatchErr] = useState<unknown>(null)
  const [matchLoading, setMatchLoading] = useState(true)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [baselineOpen, setBaselineOpen] = useState(false)
  const [baseline, setBaseline] = useState('')
  const analyzeRef = useRef<{ id: number; p: Promise<MatchResult> } | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => { if (jobQ.data) setJob(jobQ.data) }, [jobQ.data])

  useEffect(() => {
    if (Number.isNaN(id)) return
    let p: Promise<MatchResult>
    if (nonce === 0) {
      if (!analyzeRef.current || analyzeRef.current.id !== id) analyzeRef.current = { id, p: api.analyze(id) }
      p = analyzeRef.current.p
    } else p = api.getMatch(id)
    let cancel = false
    setMatchLoading(true); setMatchErr(null)
    p.then((m) => { if (!cancel) setMatch(m) }).catch((e) => { if (!cancel) setMatchErr(e) }).finally(() => { if (!cancel) setMatchLoading(false) })
    return () => { cancel = true }
  }, [id, nonce])

  const seconds = useActiveTime('job_analysis', Number.isNaN(id) ? null : id, job?.application_id)

  if (jobQ.loading && !job) return <Spinner />
  if (jobQ.error) return <ErrorState error={jobQ.error} onRetry={jobQ.reload} />
  if (!job) return null

  const shown = preview ?? match
  const profileRequired = matchErr instanceof ApiError && matchErr.code === 'profile_required'
  const refreshMatch = () => setNonce((n) => n + 1)

  const guard = async (fn: () => Promise<void>) => {
    setActionErr(null)
    try { await fn() } catch (e) { setActionErr(errMessage(e)) }
  }
  const setState = (s: UserState) => guard(async () => {
    const u = await api.setUserState(job.id, job.user_state === s ? 'new' : s)
    setJob({ ...job, ...u, raw_description: job.raw_description }); bumpData()
  })
  const startApplication = () => guard(async () => {
    await api.createApplication(job.id, 'Preparing'); bumpData(); nav(`/jobs/${job.id}/workspace`)
  })
  const markApplied = () => guard(async () => {
    const app = job.application_id
      ? await api.patchApplication(job.application_id, { status: 'Applied', date_applied: new Date().toISOString().slice(0, 10) })
      : await api.createApplication(job.id, 'Applied')
    setJob({ ...job, application_id: app.id, application_status: app.status }); bumpData()
    setBaselineOpen(true)
  })
  const saveBaseline = () => guard(async () => {
    const n = Number(baseline)
    if (job.application_id && Number.isFinite(n) && n > 0) await api.patchApplication(job.application_id, { baseline_minutes: Math.round(n) })
    setBaselineOpen(false); setBaseline('')
  })

  const analyzedNote = match && preview && <Badge tone="amber">Preview with custom weights — not saved</Badge>

  return (
    <>
      <PageHeader title={job.title}
        subtitle={<>{job.company}{job.location ? ` · ${job.location}` : ''}{job.is_remote ? ' · Remote' : ''}{job.employment_type ? ` · ${job.employment_type}` : ''}</>}
        actions={<>
          {job.posting_url && <a className="btn" href={job.posting_url} target="_blank" rel="noreferrer noopener">View posting ↗</a>}
          <Link to="/jobs" className="btn">← Jobs</Link>
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <StatusBadge status={job.application_status} />
        {job.user_state !== 'new' && <Badge tone="indigo">{job.user_state}</Badge>}
        <span>Deadline: {formatDate(job.application_deadline)} ({deadlineText(job.application_deadline)})</span>
        <span className="text-xs text-slate-500" data-testid="time-indicator">Time on this job (this visit): {Math.floor(seconds / 60)} min</span>
      </div>

      <div className="mb-5 flex flex-wrap gap-2" data-testid="job-actions">
        <button className="btn" aria-pressed={job.user_state === 'saved'} onClick={() => void setState('saved')}>{job.user_state === 'saved' ? '★ Saved' : '☆ Save'}</button>
        <button className="btn" aria-pressed={job.user_state === 'ignored'} onClick={() => void setState('ignored')}>{job.user_state === 'ignored' ? 'Unignore' : 'Ignore'}</button>
        {job.application_id
          ? <Link className="btn btn-primary" to={`/jobs/${job.id}/workspace`}>Open workspace</Link>
          : <button className="btn btn-primary" onClick={() => void startApplication()} data-testid="start-application">Start application</button>}
        <Link className="btn" to={`/resume-lab/${job.id}`}>Analyze resume</Link>
        <Link className="btn" to={`/jobs/${job.id}/workspace?tab=drafts`}>Generate draft</Link>
        {job.application_status !== 'Applied' && <button className="btn" onClick={() => void markApplied()} data-testid="mark-applied">Mark applied</button>}
      </div>
      <p className="-mt-3 mb-5 text-xs text-slate-600">CoopCompass never submits applications. “Mark applied” only records that you applied yourself.</p>
      {actionErr && <p role="alert" className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-800">{actionErr}</p>}

      {matchLoading && !match ? <Spinner label="Scoring this job…" /> : profileRequired ? (
        <EmptyState title="Profile required to score this job" action={<Link to="/profile" className="btn btn-primary">Go to Profile</Link>}>
          Match scores are computed from your skills and evidence, so create and save your profile first.
        </EmptyState>
      ) : matchErr ? <ErrorState error={matchErr} onRetry={refreshMatch} /> : shown && (
        <>
          <Section title="Match score">
            <div className="flex flex-col gap-5 sm:flex-row">
              <div className="flex flex-col items-center gap-2">
                <MatchRing score={shown.overall} size={120} lowEvidence={shown.low_evidence} />
                {analyzedNote}
                <p className="max-w-[10rem] text-center text-xs text-slate-600">Deterministic score: the sum of the factor points. No AI model sets it.</p>
              </div>
              <ul className="flex-1 space-y-3" data-testid="breakdown">
                {shown.breakdown.map((b) => (
                  <li key={b.key}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium text-slate-800">{b.label}</span>
                      <span className="tabular-nums text-slate-700">{b.points.toFixed(1)}/{b.weight}</span>
                    </div>
                    <div className="mt-1 h-2 rounded bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={b.weight} aria-valuenow={b.points} aria-label={`${b.label} ${b.points.toFixed(1)} of ${b.weight}`}>
                      <div className="h-2 rounded bg-accent-600" style={{ width: `${Math.max(0, Math.min(100, b.fraction * 100))}%` }} />
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600">{b.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
            {match && <WeightsEditor jobId={job.id} base={match.weights} onPreview={setPreview} onSaved={refreshMatch} />}
          </Section>

          <Section title="Why this matches">
            <div className="grid gap-4 lg:grid-cols-3">
              <div data-testid="strong-list">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-emerald-800">✓ STRONG</h3>
                {shown.strong.length === 0 ? <p className="text-sm text-slate-600">No strong matches found.</p> : shown.strong.map((s) => (
                  <div key={s.skill} className="mb-2"><EvidenceChip kind="strong">{s.skill}</EvidenceChip> <span className="text-xs text-slate-500">{s.kind}</span></div>
                ))}
              </div>
              <div data-testid="partial-list">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-amber-800">△ PARTIAL</h3>
                {shown.partial.length === 0 ? <p className="text-sm text-slate-600">No partial matches.</p> : shown.partial.map((s) => (
                  <div key={s.skill} className="mb-2"><EvidenceChip kind="partial">{s.skill}</EvidenceChip> <span className="text-xs text-slate-500">{s.kind}</span><p className="mt-0.5 text-xs text-slate-700">{s.reason}</p></div>
                ))}
              </div>
              <div data-testid="gap-list">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-red-800">✕ GAPS</h3>
                {shown.gaps.length === 0 ? <p className="text-sm text-slate-600">No gaps found.</p> : shown.gaps.map((g) => (
                  <div key={`${g.kind}-${g.requirement}`} className="mb-2"><EvidenceChip kind="gap">{g.requirement}</EvidenceChip><p className="mt-0.5 text-xs text-slate-700">{g.message}</p></div>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Evidence from your profile">
            <p className="mb-2 text-xs text-slate-600">Every match claim is traced back to these items in your profile.</p>
            {[...shown.strong, ...shown.partial].filter((x) => x.evidence.length).length === 0
              ? <p className="text-sm text-slate-600">No profile evidence linked to this job’s requirements.</p>
              : (
                <ul className="space-y-3" data-testid="evidence-list">
                  {[...shown.strong, ...shown.partial].filter((x) => x.evidence.length).map((x) => (
                    <li key={`${x.skill}-${x.kind}`}><div className="text-sm font-medium text-slate-800">{x.skill}</div><EvidenceList items={x.evidence} /></li>
                  ))}
                </ul>
              )}
          </Section>

          <Section title="Potential concerns">
            {shown.concerns.length === 0 ? <p className="text-sm text-slate-600">No concerns flagged.</p> : (
              <ul className="space-y-1.5">{shown.concerns.map((c, i) => <li key={i} className="text-sm text-slate-800"><span aria-hidden>△ </span><span className="font-medium">{c.type.replace(/_/g, ' ')}:</span> {c.message}</li>)}</ul>
            )}
          </Section>
        </>
      )}

      <Section title="Responsibilities">
        {job.responsibilities.length === 0 ? <p className="text-sm text-slate-600">No responsibilities were parsed from this posting.</p> : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">{job.responsibilities.map((r, i) => <li key={i}>{r}</li>)}</ul>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {job.required_skills.map((s) => <Badge key={`r-${s}`} tone="indigo">{s} · required</Badge>)}
          {job.preferred_skills.map((s) => <Badge key={`p-${s}`}>{s} · preferred</Badge>)}
        </div>
        {job.parse_notes.length > 0 && <p className="mt-3 text-xs text-slate-600">Parser notes: {job.parse_notes.join(' · ')}</p>}
      </Section>

      <Section title="Original description">
        <details>
          <summary className="cursor-pointer text-sm text-accent-700">Show raw description</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-800">{job.raw_description ?? 'No description stored.'}</pre>
        </details>
      </Section>

      <Modal open={baselineOpen} onClose={() => setBaselineOpen(false)} title="Application marked as applied">
        <label className="label" htmlFor="baseline">How long would this normally have taken you? (minutes) — optional</label>
        <input id="baseline" type="number" min={1} className="input" value={baseline} onChange={(e) => setBaseline(e.target.value)} />
        <p className="mt-1 text-xs text-slate-600">Self-reported; used only for the optional time-saved estimate.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => setBaselineOpen(false)}>Skip</button>
          <button className="btn btn-primary" onClick={() => void saveBaseline()}>Save</button>
        </div>
      </Modal>
    </>
  )
}
