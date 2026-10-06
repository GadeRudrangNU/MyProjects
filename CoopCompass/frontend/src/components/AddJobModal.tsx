import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useApp } from '../AppContext'
import { errMessage } from '../lib/format'
import type { CsvImportResult } from '../types'
import { Modal, Tabs } from './ui'

type Tab = 'paste' | 'url' | 'csv'

export function AddJobModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bumpData } = useApp()
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('paste')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [csvResult, setCsvResult] = useState<CsvImportResult | null>(null)
  const [f, setF] = useState({ company: '', title: '', location: '', employment_type: '', posting_url: '', application_deadline: '', description: '' })
  const [url, setUrl] = useState('')
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const reset = () => {
    setError(null); setNotice(null); setCsvResult(null); setUrl('')
    setF({ company: '', title: '', location: '', employment_type: '', posting_url: '', application_deadline: '', description: '' })
  }
  const close = () => { reset(); setTab('paste'); onClose() }

  const submitPaste = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const job = await api.addJob({
        company: f.company.trim(), title: f.title.trim(), description: f.description,
        location: f.location.trim() || undefined, employment_type: f.employment_type || undefined,
        posting_url: f.posting_url.trim() || undefined, application_deadline: f.application_deadline || undefined,
      })
      bumpData(); close(); nav(`/jobs/${job.id}`)
    } catch (err) { setError(errMessage(err)) } finally { setBusy(false) }
  }

  const submitUrl = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      const job = await api.addJobFromUrl(url.trim())
      bumpData(); close(); nav(`/jobs/${job.id}`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'extraction_failed') {
        setNotice(`We couldn't extract that posting automatically (${err.message}). Paste the job description instead.`)
        setF((p) => ({ ...p, posting_url: url.trim() }))
        setTab('paste')
      } else setError(errMessage(err))
    } finally { setBusy(false) }
  }

  const submitCsv = async (file: File) => {
    setBusy(true); setError(null); setCsvResult(null)
    try { const r = await api.importCsv(file); setCsvResult(r); bumpData() }
    catch (err) { setError(errMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={close} title="Add a job" wide>
      <Tabs label="Add job method" value={tab} onChange={(t) => { setTab(t); setError(null) }}
        tabs={[{ id: 'paste', label: 'Paste description' }, { id: 'url', label: 'From URL' }, { id: 'csv', label: 'CSV import' }]} />
      {notice && <p role="status" className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900">{notice}</p>}
      {error && <p role="alert" className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {tab === 'paste' && (
        <form onSubmit={submitPaste} className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="aj-company">Company *</label><input id="aj-company" required className="input" value={f.company} onChange={(e) => set('company', e.target.value)} /></div>
          <div><label className="label" htmlFor="aj-title">Title *</label><input id="aj-title" required className="input" value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div><label className="label" htmlFor="aj-loc">Location</label><input id="aj-loc" className="input" value={f.location} onChange={(e) => set('location', e.target.value)} /></div>
          <div>
            <label className="label" htmlFor="aj-type">Employment type</label>
            <select id="aj-type" className="input" value={f.employment_type} onChange={(e) => set('employment_type', e.target.value)}>
              <option value="">Not specified</option><option>co-op</option><option>internship</option><option>full-time</option><option>part-time</option><option>contract</option>
            </select>
          </div>
          <div><label className="label" htmlFor="aj-url">Posting URL</label><input id="aj-url" type="url" className="input" value={f.posting_url} onChange={(e) => set('posting_url', e.target.value)} /></div>
          <div><label className="label" htmlFor="aj-dl">Application deadline</label><input id="aj-dl" type="date" className="input" value={f.application_deadline} onChange={(e) => set('application_deadline', e.target.value)} /></div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="aj-desc">Job description *</label>
            <textarea id="aj-desc" required rows={9} className="input font-mono text-xs" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Paste the full posting text here" />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add job'}</button>
          </div>
        </form>
      )}

      {tab === 'url' && (
        <form onSubmit={submitUrl} className="grid gap-3">
          <div>
            <label className="label" htmlFor="aj-fromurl">Posting URL</label>
            <input id="aj-fromurl" type="url" required className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <p className="mt-1 text-xs text-slate-600">The page is fetched by the local backend. If extraction fails you can paste the description instead.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Fetching…' : 'Fetch and add'}</button>
          </div>
        </form>
      )}

      {tab === 'csv' && (
        <div className="grid gap-3">
          <div>
            <label className="label" htmlFor="aj-csv">CSV file</label>
            <input id="aj-csv" type="file" accept=".csv,text/csv" className="input" disabled={busy}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void submitCsv(file) }} />
            <p className="mt-1 text-xs text-slate-600">One posting per row. Duplicates are skipped by the backend.</p>
          </div>
          {busy && <p className="text-sm text-slate-600">Importing…</p>}
          {csvResult && (
            <div role="status" className="rounded-md bg-slate-50 p-3 text-sm" data-testid="csv-result">
              <p>Imported <b>{csvResult.imported}</b>, skipped <b>{csvResult.skipped_duplicates}</b> duplicates.</p>
              {csvResult.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-red-800">{csvResult.errors.map((x, i) => <li key={i}>{x}</li>)}</ul>
              )}
            </div>
          )}
          <div className="flex justify-end"><button className="btn" onClick={close}>Done</button></div>
        </div>
      )}
    </Modal>
  )
}
