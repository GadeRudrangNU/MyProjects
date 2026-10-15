import { Link } from 'react-router-dom'
import { useListMyBookings, useListMySubscriptions, useListMyVerifications } from '@/api/generated/trustpass'
import { useAuth } from '@/auth/AuthContext'
import { PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { dateTime } from '@/lib/format'

export default function DashboardPage() {
  const { user } = useAuth()
  const verifications = useListMyVerifications()
  const subscriptions = useListMySubscriptions()
  const bookings = useListMyBookings()

  const latestVerification = verifications.data?.[0]
  const activeSubscription = subscriptions.data?.find((s) => s.status === 'ACTIVE')
  const upcoming = (bookings.data ?? []).filter((b) => b.status === 'CONFIRMED' && new Date(b.startsAt) > new Date())

  return (
    <>
      <PageHeader title={`Hello, ${user?.name.split(' ')[0] ?? 'there'}`} description="Your enrollment, membership and bookings at a glance." />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Email</CardTitle>
            <CardDescription>{user?.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusBadge status={user?.emailVerified ? 'VERIFIED' : 'PENDING'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>Verified identity unlocks “Sign in with TrustPass”.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {user?.identityVerified ? <StatusBadge status="VERIFIED" /> : latestVerification ? <StatusBadge status={latestVerification.status} /> : <span className="text-sm text-muted-foreground">Not started</span>}
            {!user?.identityVerified && (
              <div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/app/identity">{latestVerification ? 'View status' : 'Verify identity'}</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Membership</CardTitle>
            <CardDescription>{activeSubscription ? `${activeSubscription.planName} plan` : 'No active plan'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeSubscription ? (
              <p className="text-sm text-muted-foreground">Renews by {dateTime(activeSubscription.currentPeriodEnd)}</p>
            ) : (
              <Button asChild size="sm">
                <Link to="/app/membership">Choose a plan</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming bookings</CardTitle>
            <CardDescription>{upcoming.length === 0 ? 'Nothing booked yet' : `${upcoming.length} confirmed`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcoming[0] && (
              <p className="text-sm text-muted-foreground">
                Next: {upcoming[0].locationName}, {dateTime(upcoming[0].startsAt)}
              </p>
            )}
            <Button asChild size="sm" variant="outline">
              <Link to="/app/book">Book a slot</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Account security</CardTitle>
          <CardDescription>
            Two-factor authentication is {user?.mfaEnabled ? 'on' : 'off'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm" variant="outline">
            <Link to="/app/account">Manage sessions and two-factor</Link>
          </Button>
        </CardContent>
      </Card>
    </>
  )
}
