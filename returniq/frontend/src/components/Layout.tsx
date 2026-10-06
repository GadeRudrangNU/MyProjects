import { NavLink, Outlet } from 'react-router-dom'
import { BarChart3, FlaskConical, Info, Package, Search, SlidersHorizontal, Target } from 'lucide-react'

const nav = [
  { to: '/', label: 'Executive dashboard', icon: BarChart3, end: true },
  { to: '/risk', label: 'Risk explorer', icon: Search },
  { to: '/scorer', label: 'Order scorer', icon: Target },
  { to: '/products', label: 'Product intelligence', icon: Package },
  { to: '/simulator', label: 'Intervention simulator', icon: SlidersHorizontal },
  { to: '/experiment', label: 'Experiment design', icon: FlaskConical },
  { to: '/limitations', label: 'Data & model limitations', icon: Info },
]

export default function Layout() {
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="shrink-0 border-b border-line bg-white md:w-60 md:border-b-0 md:border-r">
        <div className="px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-xs font-bold text-white">R</div>
            <div>
              <div className="text-sm font-semibold leading-none">ReturnIQ</div>
              <div className="mt-1 text-[11px] leading-none text-muted">Predict · Explain · Intervene · Measure</div>
            </div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:block md:space-y-0.5 md:overflow-visible">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? 'bg-brand-soft font-medium text-brand' : 'text-slate-600 hover:bg-slate-50'}`}>
              <n.icon size={16} strokeWidth={1.75} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-4 py-4 text-[11px] leading-relaxed text-muted md:block">
          Data: UCI Online Retail II (public, CC BY 4.0). The target is <b>credit notes</b>, not confirmed returns.
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl"><Outlet /></div>
      </main>
    </div>
  )
}
