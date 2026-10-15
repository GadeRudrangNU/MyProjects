import { NavLink, Outlet, Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const memberLinks = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/identity', label: 'Identity' },
  { to: '/app/membership', label: 'Membership' },
  { to: '/app/book', label: 'Book' },
  { to: '/app/bookings', label: 'My bookings' },
  { to: '/app/account', label: 'Account' },
]

const adminLinks = [
  { to: '/admin', label: 'Dashboard', end: true, roles: ['ADMIN', 'SUPPORT'] },
  { to: '/admin/users', label: 'Users', roles: ['ADMIN', 'SUPPORT'] },
  { to: '/admin/verifications', label: 'Verifications', roles: ['ADMIN', 'REVIEWER'] },
  { to: '/admin/jobs', label: 'Jobs', roles: ['ADMIN', 'SUPPORT'] },
  { to: '/admin/audit', label: 'Audit log', roles: ['ADMIN'] },
  { to: '/admin/locations', label: 'Locations', roles: ['ADMIN'] },
]

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    'rounded-md px-3 py-2 text-sm font-medium hover:bg-accent',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
  )
}

export function AppLayout({ area }: { area: 'member' | 'admin' }) {
  const { user, signOut } = useAuth()
  const links = area === 'member' ? memberLinks : adminLinks.filter((l) => user && l.roles.includes(user.role))
  const isStaff = user?.role !== 'MEMBER'

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-background focus:p-2">
        Skip to content
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link to="/app" className="flex items-center gap-2 text-lg font-semibold no-underline">
            <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
            TrustPass
          </Link>
          <nav aria-label={area === 'member' ? 'Member' : 'Staff'} className="flex flex-1 flex-wrap gap-1">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={'end' in link ? link.end : false} className={navClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {isStaff && (
              <Button asChild variant="outline" size="sm">
                <Link to={area === 'member' ? '/admin' : '/app'}>{area === 'member' ? 'Staff console' : 'Member area'}</Link>
              </Button>
            )}
            <span className="hidden text-sm text-muted-foreground sm:inline" data-testid="signed-in-as">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2 text-2xl font-semibold no-underline">
        <ShieldCheck className="h-7 w-7 text-primary" aria-hidden="true" />
        TrustPass
      </Link>
      <main className="w-full max-w-md">{children}</main>
    </div>
  )
}
