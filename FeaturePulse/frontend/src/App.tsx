import { NavLink, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Themes from './pages/Themes'
import Emerging from './pages/Emerging'
import Prioritization from './pages/Prioritization'
import Roadmap from './pages/Roadmap'
import FeedbackList from './pages/FeedbackList'
import FeedbackDetail from './pages/FeedbackDetail'
import Upload from './pages/Upload'

const NAV = [
  { to: '/', label: 'Command Center', end: true },
  { to: '/themes', label: 'Theme Explorer' },
  { to: '/emerging', label: 'Emerging Issues' },
  { to: '/prioritization', label: 'Prioritization Studio' },
  { to: '/roadmap', label: 'Roadmap Candidates' },
  { to: '/feedback', label: 'Feedback' },
  { to: '/upload', label: 'Data & Ingestion' },
]

export default function App() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-slate-900 text-slate-300 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="text-white font-semibold tracking-tight">FeaturePulse</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Feedback → roadmap decisions</div>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `block px-4 py-2 text-sm border-l-2 ${isActive ? 'bg-slate-800 text-white border-brand-600' : 'border-transparent hover:bg-slate-800/60'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 text-[11px] text-slate-500 border-t border-slate-800">AI proposes. The PM decides.</div>
      </aside>
      <main className="flex-1 min-w-0 p-6 max-w-[1400px]">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/themes" element={<Themes />} />
          <Route path="/emerging" element={<Emerging />} />
          <Route path="/prioritization" element={<Prioritization />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/feedback" element={<FeedbackList />} />
          <Route path="/feedback/:id" element={<FeedbackDetail />} />
          <Route path="/upload" element={<Upload />} />
        </Routes>
      </main>
    </div>
  )
}
