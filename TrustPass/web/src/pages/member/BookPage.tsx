import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorCode, errorMessage } from '@/api/client'
import {
  getListMyBookingsQueryKey,
  getListSlotsQueryKey,
  useCancelBooking,
  useCreateBooking,
  useJoinWaitlist,
  useLeaveWaitlist,
  useListLocations,
  useListMySubscriptions,
  useListSlots,
} from '@/api/generated/trustpass'
import type { SlotView } from '@/api/generated/model'
import { Empty, ErrorNote, Loading, PageHeader } from '@/components/common'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { dayKey, timeRange } from '@/lib/format'

export default function BookPage() {
  const queryClient = useQueryClient()
  const locations = useListLocations()
  const subscriptions = useListMySubscriptions()
  const [chosen, setChosen] = useState<string>('')
  const locationId = chosen || locations.data?.[0]?.id || ''
  const slots = useListSlots(locationId, { query: { enabled: locationId.length > 0 } })
  const book = useCreateBooking()
  const cancel = useCancelBooking()
  const join = useJoinWaitlist()
  const leave = useLeaveWaitlist()
  const [notice, setNotice] = useState<{ kind: 'success' | 'destructive'; text: string } | null>(null)

  const hasMembership = subscriptions.data?.some((s) => s.status === 'ACTIVE') ?? false

  const grouped = useMemo(() => {
    const groups = new Map<string, SlotView[]>()
    for (const slot of slots.data ?? []) {
      const key = dayKey(slot.startsAt)
      groups.set(key, [...(groups.get(key) ?? []), slot])
    }
    return [...groups.entries()]
  }, [slots.data])

  async function act(action: () => Promise<unknown>, success: string) {
    setNotice(null)
    try {
      await action()
      setNotice({ kind: 'success', text: success })
    } catch (error) {
      setNotice({ kind: 'destructive', text: errorCode(error) === 'SLOT_FULL' ? 'That slot just filled up. You can join the waitlist.' : errorMessage(error) })
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListSlotsQueryKey(locationId) }),
      queryClient.invalidateQueries({ queryKey: getListMyBookingsQueryKey() }),
    ])
  }

  return (
    <>
      <PageHeader title="Book a slot" description="Pick a location and a time. Full slots have a waitlist and the first person in line gets the next free spot." />
      <div className="space-y-6">
        {!hasMembership && !subscriptions.isLoading && (
          <Alert>
            Booking needs an active membership.{' '}
            <Link to="/app/membership" className="font-medium text-primary underline">
              Choose a plan
            </Link>
          </Alert>
        )}
        {notice && <Alert variant={notice.kind}>{notice.text}</Alert>}
        <ErrorNote error={locations.error ?? slots.error} />

        <div className="max-w-sm space-y-2">
          <Label htmlFor="location">Location</Label>
          <Select id="location" value={locationId} onChange={(e) => setChosen(e.target.value)}>
            {locations.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}, {l.address}
              </option>
            ))}
          </Select>
        </div>

        {(locations.isLoading || slots.isLoading) && <Loading label="Loading slots…" />}
        {slots.data?.length === 0 && <Empty>No upcoming slots at this location.</Empty>}

        {grouped.map(([day, daySlots]) => (
          <Card key={day}>
            <CardHeader>
              <CardTitle>{day}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {daySlots.map((slot) => (
                  <li key={slot.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="slot">
                    <div>
                      <p className="font-medium">{timeRange(slot.startsAt, slot.endsAt)}</p>
                      <p className="text-sm text-muted-foreground">
                        {slot.available > 0 ? `${slot.available} of ${slot.capacity} ${slot.capacity === 1 ? 'spot' : 'spots'} left` : 'Full'}
                        {slot.waitlistSize > 0 && ` · ${slot.waitlistSize} waiting`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {slot.myBookingId ? (
                        <>
                          <Badge variant="success">Booked</Badge>
                          <Button size="sm" variant="outline" onClick={() => void act(() => cancel.mutateAsync({ id: slot.myBookingId as string }), 'Booking cancelled.')}>
                            Cancel
                          </Button>
                        </>
                      ) : slot.onWaitlist ? (
                        <>
                          <Badge>On waitlist</Badge>
                          <Button size="sm" variant="outline" onClick={() => void act(() => leave.mutateAsync({ id: slot.id }), 'You left the waitlist.')}>
                            Leave
                          </Button>
                        </>
                      ) : slot.available > 0 ? (
                        <Button size="sm" disabled={!hasMembership} onClick={() => void act(() => book.mutateAsync({ data: { slotId: slot.id } }), 'You are booked. A confirmation email is on its way.')}>
                          Book
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" disabled={!hasMembership} onClick={() => void act(() => join.mutateAsync({ id: slot.id }), 'You are on the waitlist.')}>
                          Join waitlist
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
