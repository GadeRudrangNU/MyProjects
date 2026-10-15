import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { UserViewRole } from '@/api/generated/model'
import { useAuth } from './AuthContext'

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground" role="status">
      Loading…
    </div>
  )
}

export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function RequireRole({ roles }: { roles: UserViewRole[] }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) {
    return (
      <div className="mx-auto max-w-xl p-8" role="alert">
        <h1 className="text-xl font-semibold">Not available</h1>
        <p className="mt-2 text-muted-foreground">Your account does not have access to this area.</p>
      </div>
    )
  }
  return <Outlet />
}

export function RedirectIfAuthenticated() {
  const { status } = useAuth()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'authenticated') return <Navigate to="/app" replace />
  return <Outlet />
}
