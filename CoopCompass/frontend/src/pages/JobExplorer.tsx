import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../AppContext'
import { JobCard } from '../components/JobCard'
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { useAsync, useDebounced } from '../hooks/useAsync'
import { STATUSES, type JobQuery } from '../types'

interface Filters { q: string; role: string; location: string; company: string; status: string; application_status: string; min_score: number; remote: boolean; sort: NonNullable<JobQuery['sort']> }
const DEFAULTS: Filters = { q: '', role: '', location: '', company: '', status: '', application_status: '', min_score: 0, remote: false, sort: 'best_match' }

export function JobExplorerPage() {
  const { dataVersion, openAddJob, profile } = useApp()
  const [f, setF] = useState<Filters>(DEFAULTS)
  const d = useDebounced(f, 250)
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }))

  const jobs = useAsync(() => api.listJobs({
    q: d.q || undefined, role: d.role || undefined, location: d.location || undefined, company: d.company || undefined,
    status: d.status || undefined, application_status: d.application_status || undefined,
    min_score: d.min_score > 0 ? d.min_score : undefined, remote: d.remote || undefined, sort: d.sort,
  }), [JSON.stringify(d), dataVersion])

  const filtered = JSON.stringify(f) !== JSON.stringify(DEFAULTS)

  return (
    <>
      <PageHeader title="Job Explorer" subtitle="Search, filter and rank the jobs you have added."
        actions={<button className="btn btn-primary" onClick={openAddJob}>+ Add job</button>} />

      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Job filters" onSubmit={(e) => e.preventDefault()}>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="f-q">Search</label>
          <input id="f-q" type="search" className="input" placeholder="Keywords, title, company…" value={f.q} onChange={(e) => set('q', e.target.value)} data-testid="filter-q" />
        </div>
        <div><label className="label" htmlFor="f-role">Role</label><input id="f-role" className="input" value={f.role} onChange={(e) => set('role', e.target.value)} /></div>
        <div><label className="label" htmlFor="f-company">Company</label><input id="f-company" className="input" value={f.company} onChange={(e) => set('company', e.target.value)} /></div>
        <div><label className="label" htmlFor="f-loc">Location</label><input id="f-loc" className="input" value={f.location} onChange={(e) => set('location', e.target.value)} /></div>
        <div>
          <label className="label" htmlFor="f-state">Saved state</label>
          <select id="f-state" className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">Any</option><option value="new">New</option><option value="saved">Saved</option><option value="ignored">Ignored</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-app">Application status</label>
          <select id="f-app" className="input" value={f.application_status} onChange={(e) => set('application_status', e.target.value)}>
            <option value="">Any</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-sort">Sort by</label>
          <select id="f-sort" className="input" value={f.sort} onChange={(e) => set('sort', e.target.value as Filters['sort'])} data-testid="sort">
            <option value="best_match">Best match</option><option value="newest">Newest</option><option value="deadline">Deadline</option><option value="status">Status</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="f-min">Minimum match score: <b>{f.min_score}</b></label>
          <input id="f-min" type="range" min={0} max={100} step={5} value={f.min_score} className="w-full accent-accent-600" onChange={(e) => set('min_score', Number(e.target.value))} />
        </div>
        <div className="flex items-end justify-between gap-3 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.remote} onChange={(e) => set('remote', e.target.checked)} /> Remote only</label>
          {filtered && <button type="button" className="btn btn-sm" onClick={() => setF(DEFAULTS)}>Clear filters</button>}
        </div>
      </form>

      {profile && !profile.exists && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">No profile yet, so jobs are not scored. <Link className="underline" to="/profile">Create your profile</Link>.</p>
      )}

      {jobs.loading && !jobs.data ? <Spinner /> : jobs.error ? <ErrorState error={jobs.error} onRetry={jobs.reload} /> : jobs.data && jobs.data.length === 0 ? (
        filtered
          ? <EmptyState title="No jobs match these filters" action={<button className="btn" onClick={() => setF(DEFAULTS)}>Clear filters</button>}>Try loosening the minimum score or removing a filter.</EmptyState>
          : <EmptyState title="No jobs yet" action={<button className="btn btn-primary" onClick={openAddJob}>Add a job</button>}>Paste a job description, fetch from a URL, or import a CSV.</EmptyState>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-600" aria-live="polite">{jobs.data?.length ?? 0} jobs</p>
          <div className="grid gap-3 xl:grid-cols-2" data-testid="job-list">
            {jobs.data?.map((j) => (
              <JobCard key={j.id} job={j} onChange={(u) => jobs.setData((prev) => prev?.map((x) => (x.id === u.id ? { ...x, ...u } : x)))} />
            ))}
          </div>
        </>
      )}
    </>
  )
}
