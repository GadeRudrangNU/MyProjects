import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getListJobsQueryKey, useListJobs, useRetryJob } from '@/api/generated/trustpass'
import { ListJobsStatus } from '@/api/generated/model'
import { Empty, ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateTime } from '@/lib/format'

export default function AdminJobs() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ListJobsStatus>(ListJobsStatus.DEAD)
  const params = { status, page: 0, size: 50 }
  const jobs = useListJobs(params, { query: { refetchInterval: 5000 } })
  const retry = useRetryJob({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListJobsQueryKey(params) }) } })

  return (
    <>
      <PageHeader title="Background jobs" description="Jobs that fail are retried with exponential backoff and parked as dead after 8 attempts." />
      <div className="mb-4 max-w-xs space-y-2">
        <Label htmlFor="job-status">Status</Label>
        <Select id="job-status" value={status} onChange={(e) => setStatus(e.target.value as ListJobsStatus)}>
          <option value="DEAD">Dead letters</option>
          <option value="PENDING">Pending</option>
          <option value="RUNNING">Running</option>
          <option value="DONE">Done</option>
        </Select>
      </div>
      <ErrorNote error={jobs.error ?? retry.error} />
      {jobs.isLoading && <Loading />}
      {jobs.data?.items.length === 0 && <Empty>No jobs with this status.</Empty>}
      {(jobs.data?.items.length ?? 0) > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Last error</TableHead>
              <TableHead>Trace</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.data?.items.map((job) => (
              <TableRow key={job.id}>
                <TableCell>{job.id}</TableCell>
                <TableCell>{job.type}</TableCell>
                <TableCell>
                  <StatusBadge status={job.status} />
                </TableCell>
                <TableCell>{job.attempts}</TableCell>
                <TableCell className="max-w-xs truncate" title={job.lastError}>
                  {job.lastError ?? '—'}
                </TableCell>
                <TableCell className="font-mono text-xs">{job.traceId ?? '—'}</TableCell>
                <TableCell>{dateTime(job.createdAt)}</TableCell>
                <TableCell className="text-right">
                  {job.status === 'DEAD' && (
                    <Button size="sm" onClick={() => retry.mutate({ id: job.id })} disabled={retry.isPending}>
                      Retry
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}
