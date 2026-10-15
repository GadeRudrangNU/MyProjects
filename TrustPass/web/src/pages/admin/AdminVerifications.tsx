import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { errorMessage } from '@/api/client'
import {
  downloadVerificationDocument,
  getListVerificationQueueQueryKey,
  useDecideVerification,
  useListVerificationQueue,
} from '@/api/generated/trustpass'
import type { ReviewItem } from '@/api/generated/model'
import { ListVerificationQueueStatus } from '@/api/generated/model'
import { Empty, ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/common'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { dateOnly, dateTime } from '@/lib/format'

const FLAG_TEXT: Record<string, string> = {
  EXPIRED_DOCUMENT: 'Document is expired',
  NAME_MISMATCH: 'Name does not match the account',
  UNDERAGE: 'Under the minimum age',
  DUPLICATE_DOCUMENT: 'Same document used on another account',
}

function DocumentPreview({ item }: { item: ReviewItem }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked: string | null = null
    setUrl(null)
    setFailed(false)
    downloadVerificationDocument(item.id, { responseType: 'blob' })
      .then((blob) => {
        revoked = URL.createObjectURL(blob as unknown as Blob)
        setUrl(revoked)
      })
      .catch(() => setFailed(true))
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [item.id])

  if (failed) return <Alert variant="destructive">The document could not be loaded.</Alert>
  if (!url) return <Loading label="Loading document…" />
  if (item.contentType === 'application/pdf') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">
        Open the PDF in a new tab
      </a>
    )
  }
  return <img src={url} alt={`Submitted ${item.docType.toLowerCase().replace('_', ' ')}`} className="max-h-80 rounded-md border bg-white object-contain" />
}

function ReviewPanel({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const decide = useDecideVerification()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(decision: 'APPROVE' | 'REJECT') {
    setError(null)
    if (decision === 'REJECT' && reason.trim().length === 0) {
      setError('Write a short reason so the member knows what to fix.')
      return
    }
    try {
      await decide.mutateAsync({ id: item.id, data: { decision, reason: reason.trim() || undefined } })
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.fullName}</CardTitle>
        <CardDescription>
          {item.userEmail} · submitted {dateTime(item.createdAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Account name</dt>
          <dd>{item.accountName}</dd>
          <dt className="text-muted-foreground">Document</dt>
          <dd>{item.docType.replace('_', ' ').toLowerCase()}</dd>
          <dt className="text-muted-foreground">Date of birth</dt>
          <dd>{dateOnly(item.dateOfBirth)}</dd>
          <dt className="text-muted-foreground">ID number</dt>
          <dd className="font-mono">{item.idNumberMasked}</dd>
          <dt className="text-muted-foreground">Expires</dt>
          <dd>{dateOnly(item.idExpiry)}</dd>
        </dl>

        <div>
          <h3 className="mb-1 text-sm font-medium">Automated checks</h3>
          {item.flags.length === 0 ? (
            <Badge variant="success">All checks passed</Badge>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {item.flags.map((flag) => (
                <li key={flag}>
                  <Badge variant="destructive">{FLAG_TEXT[flag] ?? flag}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DocumentPreview item={item} />

        {item.status === 'IN_REVIEW' && (
          <div className="space-y-3 border-t pt-4">
            {error && <Alert variant="destructive">{error}</Alert>}
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (required to reject)</Label>
              <textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                className="w-full rounded-md border border-input bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void submit('APPROVE')} disabled={decide.isPending}>
                Approve
              </Button>
              <Button variant="destructive" onClick={() => void submit('REJECT')} disabled={decide.isPending}>
                Reject
              </Button>
            </div>
          </div>
        )}
        {item.status !== 'IN_REVIEW' && <StatusBadge status={item.status} />}
      </CardContent>
    </Card>
  )
}

export default function AdminVerifications() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ListVerificationQueueStatus>(ListVerificationQueueStatus.IN_REVIEW)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const params = { status, page: 0, size: 50 }
  const queue = useListVerificationQueue(params, { query: { refetchInterval: 5000 } })
  const selected = queue.data?.items.find((v) => v.id === selectedId) ?? null

  return (
    <>
      <PageHeader title="Verification review" description="Oldest submissions first. Decisions are audited and emailed to the member." />
      <div className="mb-4 max-w-xs space-y-2">
        <Label htmlFor="queue-status">Show</Label>
        <Select id="queue-status" value={status} onChange={(e) => { setStatus(e.target.value as ListVerificationQueueStatus); setSelectedId(null) }}>
          <option value="IN_REVIEW">Waiting for review</option>
          <option value="PENDING">Running automated checks</option>
          <option value="VERIFIED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </Select>
      </div>
      <ErrorNote error={queue.error} />
      {queue.isLoading && <Loading />}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div>
          {queue.data?.items.length === 0 && <Empty>Nothing in this list.</Empty>}
          <ul className="space-y-2" aria-label="Submissions">
            {queue.data?.items.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  aria-pressed={v.id === selectedId}
                  className={`w-full rounded-md border p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${v.id === selectedId ? 'bg-accent' : 'bg-card'}`}
                >
                  <span className="block font-medium">{v.fullName}</span>
                  <span className="block text-xs text-muted-foreground">{v.userEmail}</span>
                  <span className="mt-1 flex items-center gap-2 text-xs">
                    {dateTime(v.createdAt)}
                    {v.flags.length > 0 && <Badge variant="destructive">{v.flags.length} flag{v.flags.length > 1 ? 's' : ''}</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          {selected ? (
            <ReviewPanel
              key={selected.id}
              item={selected}
              onDone={() => {
                setSelectedId(null)
                void queryClient.invalidateQueries({ queryKey: getListVerificationQueueQueryKey(params) })
              }}
            />
          ) : (
            <Empty>Select a submission to review it.</Empty>
          )}
        </div>
      </div>
    </>
  )
}
