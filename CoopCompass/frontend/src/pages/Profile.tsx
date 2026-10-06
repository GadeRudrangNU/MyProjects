import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../AppContext'
import { TagInput } from '../components/TagInput'
import { Badge, ErrorState, Modal, PageHeader, Section, Spinner } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { errMessage, normaliseWeights } from '../lib/format'
import type { Education, Evidence, ProfileInput, RemotePref, ResumeUploadResult, Section as ESection, WeightKey } from '../types'

const WEIGHT_KEYS: WeightKey[] = ['skills', 'experience', 'role', 'education', 'location', 'preferences']
const EMP_TYPES = ['co-op', 'internship', 'full-time', 'part-time', 'contract']
const SECTIONS: ESection[] = ['Experience', 'Projects', 'Education', 'Skills', 'Other']
const uid = () => crypto.randomUUID()

const EMPTY: ProfileInput = {
  name: '', headline: '', target_roles: [], skills: [], experience_months: 0, education: [], preferred_locations: [],
  remote_preference: 'any', employment_types: [], industries: [], work_authorization: '', requires_sponsorship: null,
  preferred_technologies: [], salary_min: null, evidence_items: [],
  match_weights: { skills: 35, experience: 20, role: 15, education: 10, location: 10, preferences: 10 }, resume_id: null,
}

const union = (a: string[], b: string[]) => [...a, ...b.filter((x) => !a.some((y) => y.toLowerCase() === x.toLowerCase()))]

function ReviewPanel({ result, onMerge, onDiscard }: { result: ResumeUploadResult; onMerge: (p: (f: ProfileInput) => ProfileInput) => void; onDiscard: () => void }) {
  const d = result.draft
  const [skills, setSkills] = useState(d.skills.map((s) => ({ v: s, on: true })))
  const [techs, setTechs] = useState(d.technologies.map((s) => ({ v: s, on: true })))
  const [useMonths, setUseMonths] = useState(d.experience_months > 0)
  const [months, setMonths] = useState(d.experience_months)
  const [edu, setEdu] = useState(d.education.map((e) => ({ v: e, on: true })))
  const [ev, setEv] = useState([
    ...d.evidence_items.map((e) => ({ v: e, on: true })),
    ...d.projects.map((p) => ({ v: { id: uid(), section: 'Projects' as ESection, text: p.name ? `${p.name}: ${p.text}` : p.text, skills: [] }, on: true })),
  ])
  const toggle = <T,>(arr: { v: T; on: boolean }[], set: (x: { v: T; on: boolean }[]) => void, i: number) => set(arr.map((x, k) => (k === i ? { ...x, on: !x.on } : x)))

  const merge = () => onMerge((f) => ({
    ...f,
    skills: union(f.skills, skills.filter((x) => x.on).map((x) => x.v)),
    preferred_technologies: union(f.preferred_technologies, techs.filter((x) => x.on).map((x) => x.v)),
    experience_months: useMonths ? months : f.experience_months,
    education: [...f.education, ...edu.filter((x) => x.on).map((x) => x.v)],
    evidence_items: [...f.evidence_items, ...ev.filter((x) => x.on).map((x) => ({ ...x.v, id: x.v.id || uid() }))],
    resume_id: result.resume_id,
  }))

  return (
    <div className="mt-4 rounded-md border-2 border-accent-100 bg-accent-50/40 p-4" data-testid="review-panel">
      <h3 className="text-sm font-semibold text-slate-900">Review extracted information</h3>
      <p className="mt-0.5 text-xs text-slate-700">From <b>{result.filename}</b> ({result.char_count} characters). Nothing has been saved. Untick anything wrong, edit the text, then merge into the form below and click Save profile.</p>
      {result.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-amber-900">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}

      <fieldset className="mt-3"><legend className="label">Skills</legend>
        <div className="flex flex-wrap gap-2">{skills.map((s, i) => <label key={s.v} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={s.on} onChange={() => toggle(skills, setSkills, i)} />{s.v}</label>)}{!skills.length && <span className="text-xs text-slate-600">None found.</span>}</div></fieldset>
      <fieldset className="mt-3"><legend className="label">Technologies</legend>
        <div className="flex flex-wrap gap-2">{techs.map((s, i) => <label key={s.v} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={s.on} onChange={() => toggle(techs, setTechs, i)} />{s.v}</label>)}{!techs.length && <span className="text-xs text-slate-600">None found.</span>}</div></fieldset>
      <div className="mt-3 flex items-center gap-2 text-sm">
        <input id="rv-months" type="checkbox" checked={useMonths} onChange={() => setUseMonths(!useMonths)} />
        <label htmlFor="rv-months">Experience (months)</label>
        <input aria-label="Extracted experience months" type="number" min={0} className="input w-24" value={months} onChange={(e) => setMonths(Number(e.target.value))} />
      </div>
      <fieldset className="mt-3"><legend className="label">Education</legend>
        {edu.map((e, i) => <label key={i} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={e.on} onChange={() => toggle(edu, setEdu, i)} />{[e.v.degree, e.v.field, e.v.school, e.v.year].filter(Boolean).join(', ')} ({e.v.status.replace('_', ' ')})</label>)}
        {!edu.length && <span className="text-xs text-slate-600">None found.</span>}</fieldset>
      <fieldset className="mt-3"><legend className="label">Evidence bullets and projects</legend>
        <ul className="space-y-2">
          {ev.map((e, i) => (
            <li key={e.v.id} className="flex items-start gap-2">
              <input type="checkbox" className="mt-2" aria-label={`Include item ${i + 1}`} checked={e.on} onChange={() => toggle(ev, setEv, i)} />
              <div className="flex-1"><Badge>{e.v.section}</Badge>
                <textarea aria-label={`Evidence text ${i + 1}`} rows={2} className="input mt-1" value={e.v.text} onChange={(x) => setEv(ev.map((y, k) => (k === i ? { ...y, v: { ...y.v, text: x.target.value } } : y)))} />
              </div>
            </li>
          ))}
        </ul>{!ev.length && <span className="text-xs text-slate-600">None found.</span>}</fieldset>
      <div className="mt-4 flex gap-2">
        <button className="btn btn-primary" onClick={merge} data-testid="merge-draft">Merge selected into form</button>
        <button className="btn" onClick={onDiscard}>Discard</button>
      </div>
    </div>
  )
}

export function ProfilePage() {
  const { profile, profileLoaded, refreshProfile, bumpData, retry } = useApp()
  const usage = useAsync(() => api.aiUsage(), [])
  const [form, setForm] = useState<ProfileInput>(EMPTY)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [upload, setUpload] = useState<ResumeUploadResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [delOpen, setDelOpen] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  const loadedOnce = useRef(false)

  useEffect(() => {
    if (profile && !loadedOnce.current) {
      loadedOnce.current = true
      const { exists: _e, ...rest } = profile
      void _e
      setForm(rest)
    }
  }, [profile])

  const upd = (p: Partial<ProfileInput>) => { setForm((f) => ({ ...f, ...p })); setDirty(true); setMsg(null) }
  const updFn = (fn: (f: ProfileInput) => ProfileInput) => { setForm(fn); setDirty(true); setMsg(null) }

  const doUpload = async (file: File) => {
    setUploading(true); setMsg(null); setUpload(null)
    try { setUpload(await api.uploadResume(file)) } catch (e) { setMsg({ ok: false, text: errMessage(e) }) } finally { setUploading(false) }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setMsg(null)
    try {
      await api.saveProfile({ ...form, match_weights: normaliseWeights(form.match_weights) })
      loadedOnce.current = false
      await refreshProfile(); bumpData(); setDirty(false)
      setMsg({ ok: true, text: 'Profile saved.' })
    } catch (err) { setMsg({ ok: false, text: errMessage(err) }) } finally { setSaving(false) }
  }

  const deleteAll = async () => {
    setDelBusy(true)
    try {
      const r = await api.deleteAll()
      loadedOnce.current = false; setForm(EMPTY); setDirty(false); setUpload(null)
      await refreshProfile(); bumpData(); setDelOpen(false)
      setMsg({ ok: true, text: `All local data deleted (${Object.entries(r.deleted).map(([k, v]) => `${v} ${k}`).join(', ')}).` })
    } catch (err) { setMsg({ ok: false, text: errMessage(err) }); setDelOpen(false) } finally { setDelBusy(false) }
  }

  if (!profileLoaded) return <><PageHeader title="Profile" /><Spinner /></>
  if (!profile) return <><PageHeader title="Profile" /><ErrorState error={new Error("Can't load your profile.")} onRetry={retry} /></>

  const norm = normaliseWeights(form.match_weights)
  const wsum = WEIGHT_KEYS.reduce((a, k) => a + form.match_weights[k], 0)
  const setEdu = (i: number, p: Partial<Education>) => upd({ education: form.education.map((e, k) => (k === i ? { ...e, ...p } : e)) })
  const setEv = (id: string, p: Partial<Evidence>) => upd({ evidence_items: form.evidence_items.map((e) => (e.id === id ? { ...e, ...p } : e)) })

  return (
    <>
      <PageHeader title="Profile" subtitle={profile.exists ? 'Edit what the matcher knows about you.' : 'Create your profile so jobs can be ranked. Nothing is saved until you click Save.'} />

      <Section title="Resume upload">
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void doUpload(f) }}
          className={`rounded-md border-2 border-dashed p-6 text-center ${drag ? 'border-accent-600 bg-accent-50' : 'border-slate-300'}`} data-testid="dropzone">
          <p className="text-sm text-slate-700">Drag a resume here (.pdf, .docx, .txt) or</p>
          <label className="btn mt-2 cursor-pointer" htmlFor="resume-file">Choose file</label>
          <input id="resume-file" type="file" accept=".pdf,.docx,.txt" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); e.target.value = '' }} />
          <p className="mt-2 text-xs text-slate-600">The file is parsed locally. The extracted draft is shown for your review — it is not saved automatically.</p>
        </div>
        {uploading && <Spinner label="Extracting…" />}
        {upload && <ReviewPanel key={upload.resume_id} result={upload} onDiscard={() => setUpload(null)} onMerge={(fn) => { updFn(fn); setUpload(null); setMsg({ ok: true, text: 'Merged into the form below. Review it, then click Save profile.' }) }} />}
      </Section>

      <form onSubmit={save}>
        <Section title="About you">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="p-name">Name</label><input id="p-name" className="input" value={form.name} onChange={(e) => upd({ name: e.target.value })} /></div>
            <div><label className="label" htmlFor="p-head">Headline</label><input id="p-head" className="input" value={form.headline} onChange={(e) => upd({ headline: e.target.value })} placeholder="e.g. MS Data Science student seeking a 6-month co-op" /></div>
            <div><label className="label" htmlFor="p-exp">Experience (months)</label><input id="p-exp" type="number" min={0} className="input" value={form.experience_months} onChange={(e) => upd({ experience_months: Number(e.target.value) })} /></div>
            <div><label className="label" htmlFor="p-sal">Minimum salary (optional, annual)</label><input id="p-sal" type="number" min={0} className="input" value={form.salary_min ?? ''} onChange={(e) => upd({ salary_min: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="sm:col-span-2"><TagInput label="Target roles" value={form.target_roles} onChange={(v) => upd({ target_roles: v })} placeholder="e.g. Data Analyst" /></div>
            <div className="sm:col-span-2"><TagInput label="Skills" value={form.skills} onChange={(v) => upd({ skills: v })} placeholder="e.g. Python, SQL" /></div>
            <div className="sm:col-span-2"><TagInput label="Preferred technologies" value={form.preferred_technologies} onChange={(v) => upd({ preferred_technologies: v })} /></div>
            <div className="sm:col-span-2"><TagInput label="Industries" value={form.industries} onChange={(v) => upd({ industries: v })} /></div>
          </div>
        </Section>

        <Section title="Education">
          {form.education.length === 0 && <p className="mb-2 text-sm text-slate-600">No education entries yet.</p>}
          {form.education.map((e, i) => (
            <div key={i} className="mb-3 grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-5" data-testid="education-row">
              <div><label className="label" htmlFor={`ed-d-${i}`}>Degree</label><input id={`ed-d-${i}`} className="input" value={e.degree} onChange={(x) => setEdu(i, { degree: x.target.value })} /></div>
              <div><label className="label" htmlFor={`ed-f-${i}`}>Field</label><input id={`ed-f-${i}`} className="input" value={e.field} onChange={(x) => setEdu(i, { field: x.target.value })} /></div>
              <div><label className="label" htmlFor={`ed-s-${i}`}>School</label><input id={`ed-s-${i}`} className="input" value={e.school} onChange={(x) => setEdu(i, { school: x.target.value })} /></div>
              <div><label className="label" htmlFor={`ed-st-${i}`}>Status</label>
                <select id={`ed-st-${i}`} className="input" value={e.status} onChange={(x) => setEdu(i, { status: x.target.value as Education['status'] })}><option value="completed">Completed</option><option value="in_progress">In progress</option></select></div>
              <div className="flex items-end gap-2"><div className="flex-1"><label className="label" htmlFor={`ed-y-${i}`}>Year</label><input id={`ed-y-${i}`} className="input" value={e.year} onChange={(x) => setEdu(i, { year: x.target.value })} /></div>
                <button type="button" className="btn btn-sm" aria-label={`Remove education ${i + 1}`} onClick={() => upd({ education: form.education.filter((_, k) => k !== i) })}>✕</button></div>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => upd({ education: [...form.education, { degree: '', field: '', school: '', status: 'completed', year: '' }] })}>+ Add education</button>
        </Section>

        <Section title="Preferences">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><TagInput label="Preferred locations" value={form.preferred_locations} onChange={(v) => upd({ preferred_locations: v })} placeholder="e.g. Boston, MA" /></div>
            <div><label className="label" htmlFor="p-remote">Remote preference</label>
              <select id="p-remote" className="input" value={form.remote_preference} onChange={(e) => upd({ remote_preference: e.target.value as RemotePref })}>
                <option value="any">Any</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></select></div>
            <fieldset><legend className="label">Employment types</legend>
              <div className="flex flex-wrap gap-3">{EMP_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={form.employment_types.includes(t)} onChange={() => upd({ employment_types: form.employment_types.includes(t) ? form.employment_types.filter((x) => x !== t) : [...form.employment_types, t] })} />{t}</label>))}</div></fieldset>
            <div><label className="label" htmlFor="p-auth">Work authorization</label><input id="p-auth" className="input" value={form.work_authorization} onChange={(e) => upd({ work_authorization: e.target.value })} placeholder="e.g. F-1 with CPT" /></div>
            <div><label className="label" htmlFor="p-spons">Requires sponsorship</label>
              <select id="p-spons" className="input" value={form.requires_sponsorship === null ? '' : form.requires_sponsorship ? 'yes' : 'no'} onChange={(e) => upd({ requires_sponsorship: e.target.value === '' ? null : e.target.value === 'yes' })}>
                <option value="">Not specified</option><option value="yes">Yes</option><option value="no">No</option></select></div>
          </div>
        </Section>

        <Section title="Matching weights">
          <p className="mb-3 text-xs text-slate-600">Choose what matters most. Values are normalised so they sum to 100 (<span data-testid="weights-sum">{wsum > 0 ? 'currently normalised to 100' : 'set at least one weight above 0'}</span>).</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {WEIGHT_KEYS.map((k) => (
              <div key={k}><label className="label capitalize" htmlFor={`pw-${k}`}>{k}: <b data-testid={`pw-val-${k}`}>{norm[k]}</b></label>
                <input id={`pw-${k}`} type="range" min={0} max={100} value={form.match_weights[k]} className="w-full accent-accent-600" onChange={(e) => upd({ match_weights: { ...form.match_weights, [k]: Number(e.target.value) } })} /></div>
            ))}
          </div>
        </Section>

        <Section title="Evidence items" actions={<button type="button" className="btn btn-sm" onClick={() => upd({ evidence_items: [...form.evidence_items, { id: uid(), section: 'Experience', text: '', skills: [] }] })}>+ Add item</button>}>
          <p className="mb-3 text-xs text-slate-600">Every match claim is traced back to these items. Only write things that are true — suggestions and drafts can only reuse what is here.</p>
          {form.evidence_items.length === 0 && <p className="text-sm text-slate-600">No evidence items yet. Upload a resume or add resume bullets manually.</p>}
          <ul className="space-y-3">
            {form.evidence_items.map((e, i) => (
              <li key={e.id} className="rounded-md border border-slate-200 p-3" data-testid="evidence-item">
                <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                  <div><label className="label" htmlFor={`ev-s-${e.id}`}>Section</label>
                    <select id={`ev-s-${e.id}`} className="input" value={e.section} onChange={(x) => setEv(e.id, { section: x.target.value as ESection })}>{SECTIONS.map((s) => <option key={s}>{s}</option>)}</select></div>
                  <div><label className="label" htmlFor={`ev-t-${e.id}`}>Text</label><textarea id={`ev-t-${e.id}`} rows={2} className="input" value={e.text} onChange={(x) => setEv(e.id, { text: x.target.value })} /></div>
                </div>
                <div className="mt-2"><TagInput label={`Skills shown by item ${i + 1}`} value={e.skills} onChange={(v) => setEv(e.id, { skills: v })} /></div>
                <button type="button" className="btn btn-sm mt-2" onClick={() => upd({ evidence_items: form.evidence_items.filter((x) => x.id !== e.id) })}>Delete item</button>
              </li>
            ))}
          </ul>
        </Section>

        <div className="sticky bottom-0 z-20 -mx-4 mb-5 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 sm:-mx-6 sm:px-6">
          <button className="btn btn-primary" disabled={saving || !dirty && profile.exists} data-testid="save-profile">{saving ? 'Saving…' : 'Save profile'}</button>
          {dirty && <span className="text-xs text-amber-800">△ Unsaved changes</span>}
          {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-emerald-800' : 'text-red-700'}`}>{msg.ok ? '✓ ' : '✕ '}{msg.text}</span>}
        </div>
      </form>

      <Section title="Privacy and data">
        <p className="text-sm text-slate-700">Your data is stored in a local SQLite file on this machine. When AI_PROVIDER=gemini, only the selected text needed for a suggestion or draft is sent to Gemini; with local rules nothing leaves your machine.</p>
        <p className="mt-2 text-sm text-slate-700" data-testid="ai-usage">
          {usage.data ? <>AI provider: <b>{usage.data.provider}</b> ({usage.data.ai_available ? 'available' : 'not available'}). Requests today: {usage.data.requests_today} of {usage.data.daily_limit}. Cached generations: {usage.data.cached_generations}.</> : usage.error ? 'AI usage unavailable.' : 'Loading AI usage…'}
        </p>
        <button className="btn btn-danger mt-3" onClick={() => setDelOpen(true)} data-testid="delete-data">Delete all my local data</button>
      </Section>

      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Delete all local data?">
        <p className="text-sm text-slate-700">This permanently removes your profile, resumes, jobs, applications, generated text, time records and events from this machine. It cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => setDelOpen(false)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => void deleteAll()} disabled={delBusy} data-testid="confirm-delete">{delBusy ? 'Deleting…' : 'Yes, delete everything'}</button>
        </div>
      </Modal>
    </>
  )
}
