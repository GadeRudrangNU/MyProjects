import { useQueryClient } from '@tanstack/react-query'
import { getListMyBookingsQueryKey, useCancelBooking, useListMyBookings } from '@/api/generated/trustpass'
import { Empty, ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { dateTime, timeRange } from '@/lib/format'

export default function BookingsPage() {
  const queryClient = useQueryClient()
  const bookings = useListMyBookings()
  const cancel = useCancelBooking({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyBookingsQueryKey() }) } })

  return (
    <>
      <PageHeader title="My bookings" />
      {bookings.isLoading && <Loading />}
      <ErrorNote error={bookings.error ?? cancel.error} />
      {bookings.data?.length === 0 && <Empty>You have not booked anything yet.</Empty>}
      <div className="space-y-3">
        {bookings.data?.map((b) => (
          <Card key={b.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{b.locationName}</p>
                <p className="text-sm text-muted-foreground">
                  {dateTime(b.startsAt)} ({timeRange(b.startsAt, b.endsAt)})
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={b.status} />
                {b.status === 'CONFIRMED' && new Date(b.startsAt) > new Date() && (
                  <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate({ id: b.id })}>
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
