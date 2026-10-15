import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { RedirectIfAuthenticated, RequireAuth, RequireRole, FullPageSpinner } from '@/auth/guards'
import { AppLayout } from '@/components/AppLayout'
import LandingPage from '@/pages/LandingPage'
import DevMailboxPage from '@/pages/DevMailboxPage'
import LoginPage from '@/pages/auth/LoginPage'
import MfaPage from '@/pages/auth/MfaPage'
import { OAuthCallbackPage, OAuthLinkPage } from '@/pages/auth/OAuthPages'
import SignupPage from '@/pages/auth/SignupPage'
import VerifyEmailPage from '@/pages/auth/VerifyEmailPage'
import AccountPage from '@/pages/member/AccountPage'
import BookPage from '@/pages/member/BookPage'
import BookingsPage from '@/pages/member/BookingsPage'
import DashboardPage from '@/pages/member/DashboardPage'
import IdentityPage from '@/pages/member/IdentityPage'
import MembershipPage from '@/pages/member/MembershipPage'

const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'))
const AdminUsers = lazy(() => import('@/pages/admin/AdminUsers'))
const AdminVerifications = lazy(() => import('@/pages/admin/AdminVerifications'))
const AdminJobs = lazy(() => import('@/pages/admin/AdminJobs'))
const AdminAudit = lazy(() => import('@/pages/admin/AdminAudit'))
const AdminLocations = lazy(() => import('@/pages/admin/AdminLocations'))

function AdminHome() {
  const { user } = useAuth()
  return user?.role === 'REVIEWER' ? <Navigate to="/admin/verifications" replace /> : <AdminDashboard />
}

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route element={<RedirectIfAuthenticated />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/mfa" element={<MfaPage />} />
          <Route path="/signup" element={<SignupPage />} />
        </Route>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/oauth/link" element={<OAuthLinkPage />} />
        <Route path="/dev/mailbox" element={<DevMailboxPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/app" element={<AppLayout area="member" />}>
            <Route index element={<DashboardPage />} />
            <Route path="identity" element={<IdentityPage />} />
            <Route path="membership" element={<MembershipPage />} />
            <Route path="book" element={<BookPage />} />
            <Route path="bookings" element={<BookingsPage />} />
            <Route path="account" element={<AccountPage />} />
          </Route>

          <Route element={<RequireRole roles={['ADMIN', 'SUPPORT', 'REVIEWER']} />}>
            <Route path="/admin" element={<AppLayout area="admin" />}>
              <Route index element={<AdminHome />} />
              <Route element={<RequireRole roles={['ADMIN', 'SUPPORT']} />}>
                <Route path="users" element={<AdminUsers />} />
                <Route path="jobs" element={<AdminJobs />} />
              </Route>
              <Route element={<RequireRole roles={['ADMIN', 'REVIEWER']} />}>
                <Route path="verifications" element={<AdminVerifications />} />
              </Route>
              <Route element={<RequireRole roles={['ADMIN']} />}>
                <Route path="audit" element={<AdminAudit />} />
                <Route path="locations" element={<AdminLocations />} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
