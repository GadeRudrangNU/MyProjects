import { NavLink, Route, Routes } from 'react-router-dom'
import Definitions from './pages/Definitions'
import DeviceDetail from './pages/DeviceDetail'
import Devices from './pages/Devices'
import Lab from './pages/Lab'
import RunReport from './pages/RunReport'
import Runs from './pages/Runs'
import Scorecard from './pages/Scorecard'

const links = [
  { to: '/', label: 'Devices', end: true },
  { to: '/definitions', label: 'Test definitions' },
  { to: '/runs', label: 'Test runs' },
  { to: '/scorecard', label: 'Scorecard' },
  { to: '/lab', label: 'Lab' },
]

export default function App() {
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">
          <span className="logo">⚡</span> VoltBench
        </div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Devices />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/definitions" element={<Definitions />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<RunReport />} />
          <Route path="/scorecard" element={<Scorecard />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="*" element={<div className="state muted">Page not found.</div>} />
        </Routes>
      </main>
    </div>
  )
}
