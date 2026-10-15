import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useGetMetricsSummary } from '@/api/generated/trustpass'
import { ErrorNote, Loading, PageHeader } from '@/components/common'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { shortDay } from '@/lib/format'

const axis = { stroke: 'hsl(var(--muted-foreground))', fontSize: 12 }
const tooltip = {
  contentStyle: { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--foreground))' },
  cursor: { fill: 'hsl(var(--muted))' },
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  )
}

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64" role="img" aria-label={`${title}. ${description}`}>
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

export default function AdminDashboard() {
  const summary = useGetMetricsSummary({ query: { refetchInterval: 10_000 } })
  const data = summary.data

  const signups = data?.signupsPerDay.map((d) => ({ day: shortDay(d.day), count: d.count })) ?? []
  const failed = data?.failedLoginsPerDay.map((d) => ({ day: shortDay(d.day), count: d.count })) ?? []
  const locations = data?.bookingsPerLocation ?? []
  const jobs = Object.entries(data?.jobsByStatus ?? {}).map(([status, count]) => ({ status, count }))
  const dead = data?.jobsByStatus?.DEAD ?? 0

  return (
    <>
      <PageHeader title="Dashboard" description="Live numbers from the last 14 days." />
      {summary.isLoading && <Loading />}
      <ErrorNote error={summary.error} />
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Members" value={data.totalUsers} />
            <Stat label="Active memberships" value={data.activeMemberships} />
            <Stat label="Confirmed bookings" value={data.confirmedBookings} />
            <Stat label="Verification pass rate" value={`${Math.round(data.verificationPassRate * 100)}%`} hint="Approved out of all decided" />
          </div>

          {dead > 0 && (
            <div role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">
              {dead} background job{dead === 1 ? '' : 's'} failed every retry. Review them on the Jobs page.
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Signups per day" description="New accounts created each day.">
              <LineChart data={signups}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...tooltip} />
                <Line type="monotone" dataKey="count" name="Signups" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartCard>
            <ChartCard title="Failed logins per day" description="Wrong passwords and locked accounts.">
              <BarChart data={failed}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...tooltip} />
                <Bar dataKey="count" name="Failed logins" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="Bookings per location" description="Confirmed bookings across all slots.">
              <BarChart data={locations}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="location" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...tooltip} />
                <Bar dataKey="bookings" name="Bookings" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="Background jobs" description="Queue state: pending backlog, finished and dead.">
              <BarChart data={jobs}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="status" {...axis} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...tooltip} />
                <Bar dataKey="count" name="Jobs" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>
          </div>
        </div>
      )}
    </>
  )
}
