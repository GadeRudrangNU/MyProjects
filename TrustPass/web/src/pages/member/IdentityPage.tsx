import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '@/api/client'
import { getListMyVerificationsQueryKey, useListMyVerifications, useSubmitVerification } from '@/api/generated/trustpass'
import type { VerificationFormDocType } from '@/api/generated/model'
import { useAuth } from '@/auth/AuthContext'
import { Empty, ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/common'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { dateTime } from '@/lib/format'

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'application/pdf']

const STATUS_COPY: Record<string, string> = {
  PENDING: 'We received your document and are running automated checks.',
  IN_REVIEW: 'The automated checks are done. A reviewer will look at your document shortly.',
  VERIFIED: 'Your identity is verified.',
  REJECTED: 'We could not approve this submission. You can submit a new document below.',
}

export default function IdentityPage() {
  const { user, reload } = useAuth()
  const queryClient = useQueryClient()
  const history = useListMyVerifications({ query: { refetchInterval: 5000 } })
  const submit = useSubmitVerification()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const latest = history.data?.[0]
  const open = latest && (latest.status === 'PENDING' || latest.status === 'IN_REVIEW')
  const canSubmit = !user?.identityVerified && !open

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const form = new FormData(event.currentTarget)
    const file = form.get('document')
    if (!(file instanceof File) || file.size === 0) {
      setError('Choose a photo or PDF of your document.')
      return
    }
    if (!ACCEPTED.includes(file.type)) {
      setError('Only JPEG, PNG or PDF files are accepted.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('The file is larger than 5 MB.')
      return
    }
    try {
      await submit.mutateAsync({
        data: {
          document: file,
          docType: form.get('docType') as VerificationFormDocType,
          fullName: String(form.get('fullName')),
          dateOfBirth: String(form.get('dateOfBirth')),
          idNumber: String(form.get('idNumber')),
          idExpiry: String(form.get('idExpiry')),
        },
      })
      setDone(true)
      await queryClient.invalidateQueries({ queryKey: getListMyVerificationsQueryKey() })
      await reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader title="Identity verification" description="Upload a government ID. Your date of birth and ID number are encrypted and masked in logs." />
      <div className="space-y-6">
        {history.isLoading && <Loading />}
        <ErrorNote error={history.error} />
        {done && <Alert variant="success">Submitted. We will email you when there is a decision.</Alert>}
        {latest && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                Current status <StatusBadge status={latest.status} />
              </CardTitle>
              <CardDescription>{STATUS_COPY[latest.status]}</CardDescription>
            </CardHeader>
            {latest.rejectReason && (
              <CardContent>
                <Alert variant="destructive">Reviewer note: {latest.rejectReason}</Alert>
              </CardContent>
            )}
          </Card>
        )}

        {canSubmit && (
          <Card>
            <CardHeader>
              <CardTitle>{latest ? 'Submit a new document' : 'Submit your document'}</CardTitle>
              <CardDescription>JPEG, PNG or PDF up to 5 MB. The name must match your account.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" aria-label="Identity document form">
                {error && (
                  <div className="sm:col-span-2">
                    <Alert variant="destructive">{error}</Alert>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="docType">Document type</Label>
                  <Select id="docType" name="docType" defaultValue="PASSPORT" required>
                    <option value="PASSPORT">Passport</option>
                    <option value="DRIVERS_LICENSE">Driver&apos;s license</option>
                    <option value="NATIONAL_ID">National ID</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full name on document</Label>
                  <Input id="fullName" name="fullName" defaultValue={user?.name} required maxLength={160} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dateOfBirth">Date of birth</Label>
                  <Input id="dateOfBirth" name="dateOfBirth" type="date" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="idNumber">ID number</Label>
                  <Input id="idNumber" name="idNumber" required minLength={4} maxLength={40} pattern="[A-Za-z0-9\-]{4,40}" autoComplete="off" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="idExpiry">Expiry date</Label>
                  <Input id="idExpiry" name="idExpiry" type="date" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="document">Document image</Label>
                  <Input id="document" name="document" type="file" accept="image/jpeg,image/png,application/pdf" required />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={submit.isPending}>
                    {submit.isPending ? 'Uploading…' : 'Submit for verification'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {history.data && history.data.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Earlier submissions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {history.data.slice(1).map((v) => (
                  <li key={v.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{dateTime(v.createdAt)}</span>
                    <StatusBadge status={v.status} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        {history.data?.length === 0 && !canSubmit && <Empty>No submissions yet.</Empty>}
      </div>
    </>
  )
}
