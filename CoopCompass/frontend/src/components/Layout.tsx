import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp } from '../AppContext'
import { AddJobModal } from './AddJobModal'
import { ErrorState } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▦', id: 'dashboard', end: true },
  { to: '/jobs', label: 'Job Explorer', icon: '⌕', id: 'jobs' },
  { to: '/resume-lab', label: 'Resume Lab', icon: '✎', id: 'resume-lab' },
  { to: '/tracker', label: 'Tracker', icon: '☰', id: 'tracker' },
  { to: '/analytics', label: 'Analytics', icon: '◔', id: 'analytics' },
  { to: '/profile', label: 'Profile', icon: '◉', id: 'profile' },
]

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} data-testid={`nav-${n.id}`} onClick={onNavigate}
          className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-accent-50 text-accent-700' : 'text-slate-700 hover:bg-slate-100'}`}>
          <span aria-hidden className="w-4 text-center">{n.icon}</span>{n.label}
        </NavLink>
      ))}
    </nav>
  )
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { openAddJob } = useApp()
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="px-2 pt-1 text-base font-semibold text-slate-900">CoopCompass</div>
      <button className="btn btn-primary" data-testid="add-job-button" onClick={() => { onNavigate?.(); openAddJob() }}>+ Add job</button>
      <NavList onNavigate={onNavigate} />
      <p className="mt-auto px-2 text-xs leading-relaxed text-slate-600" data-testid="local-note">
        Local-first • your data stays on this machine. Stored in a local SQLite file; only selected text is sent to Gemini when AI_PROVIDER=gemini.
      </p>
    </div>
  )
}

export function Layout() {
  const { healthError, retry, addJobOpen, closeAddJob } = useApp()
  const [drawer, setDrawer] = useState(false)
  const loc = useLocation()
  useEffect(() => setDrawer(false), [loc.pathname])

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block" aria-label="Sidebar">
        <div className="sticky top-0 h-screen overflow-y-auto"><SidebarBody /></div>
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 md:hidden">
        <span className="font-semibold text-slate-900">CoopCompass</span>
        <button className="btn" aria-expanded={drawer} aria-controls="mobile-drawer" onClick={() => setDrawer((d) => !d)} data-testid="menu-toggle">
          {drawer ? 'Close' : 'Menu'}
        </button>
      </header>
      {drawer && (
        <div id="mobile-drawer" className="fixed inset-x-0 top-[49px] bottom-0 z-30 overflow-y-auto border-t border-slate-200 bg-white md:hidden">
          <SidebarBody onNavigate={() => setDrawer(false)} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          {healthError ? <ErrorState error={healthError} onRetry={retry} /> : <Outlet />}
        </main>
      </div>
      <AddJobModal open={addJobOpen} onClose={closeAddJob} />
    </div>
  )
}
