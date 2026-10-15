import type { ReactNode } from 'react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { errorMessage } from '@/api/client'

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

export function ErrorNote({ error, fallback }: { error: unknown; fallback?: string }) {
  if (!error) return null
  return <Alert variant="destructive">{errorMessage(error, fallback)}</Alert>
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {label}
    </p>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>
}

const STATUS_STYLE: Record<string, 'success' | 'destructive' | 'secondary' | 'default' | 'outline'> = {
  VERIFIED: 'success',
  APPROVED: 'success',
  ACTIVE: 'success',
  SUCCEEDED: 'success',
  CONFIRMED: 'success',
  DONE: 'success',
  REJECTED: 'destructive',
  FAILED: 'destructive',
  DEAD: 'destructive',
  CANCELLED: 'secondary',
  PENDING: 'secondary',
  IN_REVIEW: 'default',
  RUNNING: 'default',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_STYLE[status] ?? 'outline'}>{status.replace('_', ' ').toLowerCase()}</Badge>
}
