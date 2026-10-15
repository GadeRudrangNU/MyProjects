import { useState } from 'react'
import { useListAuditLog } from '@/api/generated/trustpass'
import { Empty, ErrorNote, Loading, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateTime } from '@/lib/format'

const PAGE_SIZE = 25

export default function AdminAudit() {
  const [action, setAction] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState(0)
  const log = useListAuditLog({ page, size: PAGE_SIZE, ...(applied ? { action: applied } : {}) })
  const pages = Math.max(1, Math.ceil((log.data?.total ?? 0) / PAGE_SIZE))

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sensitive actions. The database rejects any update or delete." />
      <form
        className="mb-4 flex max-w-lg items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(0)
          setApplied(action.trim().toUpperCase())
        }}
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="audit-action">Filter by action</Label>
          <Input id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. LOGIN, VERIFICATION_APPROVED" />
        </div>
        <Button type="submit">Apply</Button>
      </form>
      <ErrorNote error={log.error} />
      {log.isLoading && <Loading />}
      {log.data?.items.length === 0 && <Empty>No entries.</Empty>}
      {(log.data?.items.length ?? 0) > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>IP address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.data?.items.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap">{dateTime(entry.at)}</TableCell>
                <TableCell>{entry.actorEmail ?? 'system'}</TableCell>
                <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                <TableCell className="text-xs">
                  {entry.targetType ? `${entry.targetType} ${entry.targetId ?? ''}` : '—'}
                </TableCell>
                <TableCell>{entry.ip ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Page {page + 1} of {pages} · {log.data?.total ?? 0} entries
        </span>
        <div className="space-x-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Older
          </Button>
        </div>
      </div>
    </>
  )
}
