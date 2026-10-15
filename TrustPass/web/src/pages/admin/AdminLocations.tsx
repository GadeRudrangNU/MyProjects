import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { errorMessage } from '@/api/client'
import {
  getListLocationsQueryKey,
  getListSlotsQueryKey,
  useCreateLocation,
  useCreateSlot,
  useListLocations,
  useListSlots,
} from '@/api/generated/trustpass'
import { Empty, ErrorNote, PageHeader } from '@/components/common'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { dateTime } from '@/lib/format'

const locationSchema = z.object({ name: z.string().trim().min(1, 'Enter a name').max(120), address: z.string().trim().min(1, 'Enter an address').max(240) })
const slotSchema = z.object({
  startsAt: z.string().min(1, 'Choose a start'),
  durationMinutes: z.coerce.number().int().min(15, 'At least 15 minutes').max(480),
  capacity: z.coerce.number().int().min(1, 'At least 1').max(500),
})

export default function AdminLocations() {
  const queryClient = useQueryClient()
  const locations = useListLocations()
  const [chosen, setChosen] = useState('')
  const locationId = chosen || locations.data?.[0]?.id || ''
  const slots = useListSlots(locationId, { query: { enabled: locationId.length > 0 } })
  const createLocation = useCreateLocation()
  const createSlot = useCreateSlot()
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const locationForm = useForm<z.infer<typeof locationSchema>>({ resolver: zodResolver(locationSchema) })
  const slotForm = useForm<z.input<typeof slotSchema>, unknown, z.output<typeof slotSchema>>({
    resolver: zodResolver(slotSchema),
    defaultValues: { durationMinutes: 60, capacity: 4 },
  })

  async function addLocation(values: z.infer<typeof locationSchema>) {
    setError(null)
    try {
      const created = await createLocation.mutateAsync({ data: values })
      await queryClient.invalidateQueries({ queryKey: getListLocationsQueryKey() })
      setChosen(created.id)
      locationForm.reset()
      setNotice(`Created ${created.name}.`)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function addSlot(values: z.output<typeof slotSchema>) {
    setError(null)
    const start = new Date(values.startsAt)
    try {
      await createSlot.mutateAsync({
        id: locationId,
        data: {
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + values.durationMinutes * 60_000).toISOString(),
          capacity: values.capacity,
        },
      })
      await queryClient.invalidateQueries({ queryKey: getListSlotsQueryKey(locationId) })
      setNotice('Slot added.')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader title="Locations and slots" description="Create places and the time slots members can book." />
      {notice && <Alert variant="success" className="mb-4">{notice}</Alert>}
      {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}
      <ErrorNote error={locations.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New location</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={locationForm.handleSubmit(addLocation)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="loc-name">Name</Label>
                <Input id="loc-name" {...locationForm.register('name')} />
                {locationForm.formState.errors.name && <p className="text-sm text-destructive">{locationForm.formState.errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="loc-address">Address</Label>
                <Input id="loc-address" {...locationForm.register('address')} />
                {locationForm.formState.errors.address && <p className="text-sm text-destructive">{locationForm.formState.errors.address.message}</p>}
              </div>
              <Button type="submit">Add location</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New slot</CardTitle>
            <CardDescription>Capacity is how many members can hold the slot at once.</CardDescription>
          </CardHeader>
          <CardContent>
            {locationId ? (
              <form onSubmit={slotForm.handleSubmit(addSlot)} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="slot-location">Location</Label>
                  <Select id="slot-location" value={locationId} onChange={(e) => setChosen(e.target.value)}>
                    {locations.data?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slot-start">Starts</Label>
                  <Input id="slot-start" type="datetime-local" {...slotForm.register('startsAt')} />
                  {slotForm.formState.errors.startsAt && <p className="text-sm text-destructive">{slotForm.formState.errors.startsAt.message}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="slot-duration">Minutes</Label>
                    <Input id="slot-duration" type="number" {...slotForm.register('durationMinutes')} />
                    {slotForm.formState.errors.durationMinutes && <p className="text-sm text-destructive">{slotForm.formState.errors.durationMinutes.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slot-capacity">Capacity</Label>
                    <Input id="slot-capacity" type="number" {...slotForm.register('capacity')} />
                    {slotForm.formState.errors.capacity && <p className="text-sm text-destructive">{slotForm.formState.errors.capacity.message}</p>}
                  </div>
                </div>
                <Button type="submit">Add slot</Button>
              </form>
            ) : (
              <Empty>Create a location first.</Empty>
            )}
          </CardContent>
        </Card>
      </div>

      {locationId && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Upcoming slots</CardTitle>
          </CardHeader>
          <CardContent>
            {slots.data?.length === 0 && <Empty>No upcoming slots.</Empty>}
            <ul className="divide-y">
              {slots.data?.map((s) => (
                <li key={s.id} className="flex justify-between py-2 text-sm">
                  <span>{dateTime(s.startsAt)}</span>
                  <span className="text-muted-foreground">
                    {s.booked} of {s.capacity} booked
                    {s.waitlistSize > 0 ? `, ${s.waitlistSize} waiting` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  )
}
