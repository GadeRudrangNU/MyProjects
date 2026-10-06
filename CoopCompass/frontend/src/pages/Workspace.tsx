import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useApp } from '../AppContext'
import { TailorPanel } from '../components/TailorPanel'
import { Badge, CopyButton, DisclaimerBanner, EmptyState, ErrorState, PageHeader, Section, Spinner, Tabs } from '../components/ui'
import { useActiveTime } from '../hooks/useActiveTime'
import { useAsync } from '../hooks/useAsync'
import { errMessage, formatDate, titleCaseKind } from '../lib/format'
import { STATUSES, type Application, type ApplicationPatch, type ChecklistItem, type Draft, type DraftKind } from '../types'

type Tab = 'description' | 'suggestions' | 'drafts' | 'notes' | 'checklist'
const TABS: { id: Tab; label: string }[] = [
  { id: 'description', label: 'Job description' }, { id: 'suggestions', label: 'Resume suggestions' },
  { id: 'drafts', label: 'Drafts' }, { id: 'notes', label: 'Notes' }, { id: 'checklist', label: 'Checklist' },
]
const KINDS: { id: DraftKind; label: string }[] = [
  { id: 'cover_letter', label: 'Cover letter' }, { id: 'short_answer', label: 'Short answer' },
  { id: 'recruiter_outreach', label: 'Recruiter outreach' }, { id: 'networking', label: 'Networking message' },
]

function DraftsTab({ jobId }: { jobId: number }) {
  const list = useAsync(() => api.listDrafts(jobId), [jobId])
  const [kind, setKind] = useState<DraftKind>('cover_letter')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [active, setActive] = useState<Draft | null>(null)
  const [text, setText] = useState('')

  const show = (d: Draft) => { setActive(d); setText(d.text) }
  const generate = async (force?: boolean) => {
    setBusy(true); setErr(null)
    try {
      const d = await api.createDraft(jobId, kind, kind === 'short_answer' ? question : undefined, force)
      show(d); list.reload()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const profileRequired = err instanceof ApiError && err.code === 'profile_required'

  return (
    <div data-testid="drafts-tab">
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <div>
          <label className="label" htmlFor="draft-kind">Draft type</label>
          <select id="draft-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as DraftKind)}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select>
        </div>
        {kind === 'short_answer' && (
          <div>
            <label className="label" htmlFor="draft-q">Question to answer</label>
            <textarea id="draft-q" rows={2} className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Why are you interested in this role?" />
          </div>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn btn-primary" disabled={busy || (kind === 'short_answer' && !question.trim())} onClick={() => void generate()} data-testid="generate-draft">{busy ? 'Generating…' : 'Generate'}</button>
        {active && <button className="btn" disabled={busy} onClick={() => void generate(true)}>Regenerate</button>}
      </div>
      {err !== null && (profileRequired
        ? <p role="alert" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Create your profile first — drafts are built only from facts in it. <Link to="/profile" className="underline">Go to Profile</Link></p>
        : <div className="mt-3"><ErrorState error={err} /></div>)}

      {active && (
        <div className="mt-4 grid gap-2" data-testid="draft-editor">
          <DisclaimerBanner text={active.disclaimer} template={active.is_template} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Badge>{titleCaseKind(active.kind)}</Badge><Badge>{active.provider === 'gemini' ? 'Gemini' : 'Local rules'}</Badge>{active.cached && <Badge>cached</Badge>}
          </div>
          <label className="label" htmlFor="draft-text">Draft text (edit freely; edits stay on this page until you copy them)</label>
          <textarea id="draft-text" rows={14} className="input" value={text} onChange={(e) => setText(e.target.value)} />
          {active.facts_used.length > 0 && (
            <details className="text-xs text-slate-700"><summary className="cursor-pointer">Facts from your profile used in this draft ({active.facts_used.length})</summary>
              <ul className="mt-1 list-disc pl-5">{active.facts_used.map((f, i) => <li key={i}>{f}</li>)}</ul></details>
          )}
          <div><CopyButton text={text} label="Copy text" /></div>
        </div>
      )}

      <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Earlier drafts</h3>
      {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? (
        <p className="text-sm text-slate-600">No drafts generated for this job yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {list.data.map((d) => (
            <li key={d.generation_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate"><b>{titleCaseKind(d.kind)}</b> · {d.is_template ? 'template' : d.provider} <span className="text-slate-500">— {d.text.slice(0, 70)}…</span></span>
              <button className="btn btn-sm" onClick={() => show(d)}>Open</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NotesTab({ app, save }: { app: Application; save: (p: ApplicationPatch) => Promise<void> }) {
  const [notes, setNotes] = useState(app.notes)
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setState('saving')
    const t = window.setTimeout(() => { save({ notes }).then(() => setState('saved')).catch(() => setState('error')) }, 800)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes])
  return (
    <div>
      <label className="label" htmlFor="notes">Notes</label>
      <textarea id="notes" rows={12} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="notes" />
      <p className="mt-1 text-xs text-slate-600" aria-live="polite">{state === 'saving' ? 'Saving…' : state === 'error' ? 'Could not save — will retry on next edit.' : 'Saved automatically.'}</p>
    </div>
  )
}

function ChecklistTab({ app, save }: { app: Application; save: (p: ApplicationPatch) => Promise<void> }) {
  const [items, setItems] = useState<ChecklistItem[]>(app.checklist)
  const [label, setLabel] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const push = async (next: ChecklistItem[]) => {
    const prev = items; setItems(next); setErr(null)
    try { await save({ checklist: next }) } catch (e) { setItems(prev); setErr(errMessage(e)) }
  }
  return (
    <div data-testid="checklist">
      {items.length === 0 && <p className="mb-3 text-sm text-slate-600">No checklist items yet. Add things like “Tailor resume” or “Request reference”.</p>}
      <ul className="mb-3 space-y-1.5">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 text-sm">
            <input id={`ck-${it.id}`} type="checkbox" checked={it.done} onChange={() => void push(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} />
            <label htmlFor={`ck-${it.id}`} className={it.done ? 'text-slate-500 line-through' : ''}>{it.label}</label>
            <button className="ml-auto text-xs text-slate-500 hover:text-red-700" aria-label={`Remove ${it.label}`} onClick={() => void push(items.filter((x) => x.id !== it.id))}>✕</button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!label.trim()) return; void push([...items, { id: crypto.randomUUID(), label: label.trim(), done: false }]); setLabel('') }}>
        <label className="sr-only" htmlFor="ck-new">New checklist item</label>
        <input id="ck-new" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add an item" />
        <button className="btn">Add</button>
      </form>
      {err && <p role="alert" className="mt-2 text-xs text-red-700">{err}</p>}
    </div>
  )
}

export function WorkspacePage() {
  const jobId = Number(useParams().id)
  const [sp, setSp] = useSearchParams()
  const { bumpData } = useApp()
  const tab = (TABS.find((t) => t.id === sp.get('tab'))?.id ?? 'description') as Tab
  const job = useAsync(() => api.getJob(jobId), [jobId])
  const appQ = useAsync(async () => {
    const existing = (await api.listApplications()).find((a) => a.job_id === jobId)
    return existing ?? (await api.createApplication(jobId))
  }, [jobId])
  const [app, setApp] = useState<Application | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const created = useRef(false)
  useEffect(() => { if (appQ.data) { setApp(appQ.data); if (!created.current) { created.current = true; bumpData() } } }, [appQ.data, bumpData])

  const seconds = useActiveTime('application_preparation', Number.isNaN(jobId) ? null : jobId, app?.id)

  const save = async (p: ApplicationPatch) => {
    if (!app) return
    try { setApp(await api.patchApplication(app.id, p)); setSaveErr(null); if (p.status || p.deadline !== undefined) bumpData() }
    catch (e) { setSaveErr(errMessage(e)); throw e }
  }

  if ((job.loading && !job.data) || (appQ.loading && !app)) return <Spinner />
  if (job.error) return <ErrorState error={job.error} onRetry={job.reload} />
  if (appQ.error) return <ErrorState error={appQ.error} onRetry={appQ.reload} />
  if (!job.data || !app) return null
  const j = job.data
  const totalMin = Math.round(app.assisted_minutes + seconds / 60)

  return (
    <>
      <PageHeader title={`${j.title}`} subtitle={<>{j.company}{j.location ? ` · ${j.location}` : ''} · Application workspace</>}
        actions={<><Link to={`/jobs/${j.id}`} className="btn">Job match</Link><Link to="/tracker" className="btn">Tracker</Link></>} />
      <p className="-mt-3 mb-4 text-xs text-slate-600" data-testid="time-indicator">Time on this job: {totalMin} min <span className="text-slate-400">(tracked active time, including this visit)</span></p>
      {saveErr && <p role="alert" className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-800">Couldn't save: {saveErr}</p>}

      <Section title="Application details">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="app-fields">
          <div>
            <label className="label" htmlFor="w-status">Status</label>
            <select id="w-status" className="input" value={app.status} onChange={(e) => void save({ status: e.target.value }).catch(() => {})} data-testid="status-select">
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="w-rv">Resume version</label><input id="w-rv" className="input" defaultValue={app.resume_version ?? ''} placeholder="e.g. v2-data" onBlur={(e) => { if (e.target.value !== (app.resume_version ?? '')) void save({ resume_version: e.target.value || null }).catch(() => {}) }} /></div>
          <div><label className="label" htmlFor="w-dl">Deadline</label><input id="w-dl" type="date" className="input" defaultValue={app.deadline?.slice(0, 10) ?? ''} onBlur={(e) => { if (e.target.value !== (app.deadline?.slice(0, 10) ?? '')) void save({ deadline: e.target.value || null }).catch(() => {}) }} /></div>
          <div><label className="label" htmlFor="w-na">Next action</label><input id="w-na" className="input" defaultValue={app.next_action} onBlur={(e) => { if (e.target.value !== app.next_action) void save({ next_action: e.target.value }).catch(() => {}) }} /></div>
          <div><label className="label" htmlFor="w-bl">Usual time to apply (min)</label><input id="w-bl" type="number" min={1} className="input" defaultValue={app.baseline_minutes ?? ''} onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; if (v !== app.baseline_minutes) void save({ baseline_minutes: v }).catch(() => {}) }} /></div>
        </div>
        <p className="mt-2 text-xs text-slate-600">Deadline: {formatDate(app.deadline)}. CoopCompass never submits applications — apply on the employer’s site yourself, then set the status to Applied.</p>
      </Section>

      <Tabs label="Workspace sections" tabs={TABS} value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} />
      {tab === 'description' && (
        <div className="card p-4">
          {j.raw_description ? <pre className="whitespace-pre-wrap text-sm text-slate-800">{j.raw_description}</pre> : <EmptyState title="No description stored" />}
        </div>
      )}
      {tab === 'suggestions' && <TailorPanel jobId={j.id} />}
      {tab === 'drafts' && <DraftsTab jobId={j.id} />}
      {tab === 'notes' && <NotesTab app={app} save={save} />}
      {tab === 'checklist' && <ChecklistTab app={app} save={save} />}
    </>
  )
}
