import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  getListUsersQueryKey,
  useChangeUserRole,
  useListUsers,
  useRevokeUserSessions,
  useUnlockUser,
} from '@/api/generated/trustpass'
import { UserViewRole } from '@/api/generated/model'
import { useAuth } from '@/auth/AuthContext'
import { Empty, ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/common'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateOnly } from '@/lib/format'

const PAGE_SIZE = 15

export default function AdminUsers() {
  const { user: me } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const params = { q: applied, page, size: PAGE_SIZE }
  const users = useListUsers(params)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey(params) })
  const changeRole = useChangeUserRole({ mutation: { onSuccess: invalidate } })
  const unlock = useUnlockUser({ mutation: { onSuccess: invalidate } })
  const revoke = useRevokeUserSessions()
  const isAdmin = me?.role === 'ADMIN'
  const pages = Math.max(1, Math.ceil((users.data?.total ?? 0) / PAGE_SIZE))

  return (
    <>
      <PageHeader title="Users" description="Search accounts, unlock them and end their sessions. Only admins change roles." />
      <form
        className="mb-4 flex max-w-lg items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(0)
          setApplied(search.trim())
        }}
      >
        <div className="flex-1 space-y-2">
          <Label htmlFor="user-search">Search by name or email</Label>
          <Input id="user-search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {notice && <Alert className="mb-4" variant="success">{notice}</Alert>}
      <ErrorNote error={users.error ?? changeRole.error ?? unlock.error ?? revoke.error} />
      {users.isLoading && <Loading />}
      {users.data?.items.length === 0 && <Empty>No users match.</Empty>}
      {(users.data?.items.length ?? 0) > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data?.items.map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  {isAdmin && u.id !== me?.id ? (
                    <Select
                      aria-label={`Role for ${u.email}`}
                      value={u.role}
                      onChange={(e) => changeRole.mutate({ id: u.id, data: { role: e.target.value as UserViewRole } })}
                      className="h-8 w-32"
                    >
                      {Object.values(UserViewRole).map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge variant="outline">{u.role}</Badge>
                  )}
                </TableCell>
                <TableCell className="space-x-1">
                  {u.locked && <Badge variant="destructive">locked</Badge>}
                  {!u.emailVerified && <StatusBadge status="PENDING" />}
                  {u.identityVerified && <StatusBadge status="VERIFIED" />}
                  {u.mfaEnabled && <Badge variant="secondary">2FA</Badge>}
                </TableCell>
                <TableCell>{dateOnly(u.createdAt)}</TableCell>
                <TableCell className="space-x-2 text-right">
                  {u.locked && (
                    <Button size="sm" variant="outline" onClick={() => unlock.mutate({ id: u.id })}>
                      Unlock
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke.mutateAsync({ id: u.id }).then(() => setNotice(`Signed ${u.email} out everywhere.`))}
                  >
                    End sessions
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Page {page + 1} of {pages} · {users.data?.total ?? 0} users
        </span>
        <div className="space-x-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </>
  )
}
