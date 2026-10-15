import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { errorMessage } from '@/api/client'
import {
  getListSessionsQueryKey,
  useDisableMfa,
  useEnableMfa,
  useListSessions,
  useRevokeAllSessions,
  useRevokeSession,
  useSetupMfa,
} from '@/api/generated/trustpass'
import type { Setup } from '@/api/generated/model'
import { useAuth } from '@/auth/AuthContext'
import { Empty, ErrorNote, Loading, PageHeader } from '@/components/common'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeAgent, dateTime } from '@/lib/format'

function Sessions() {
  const queryClient = useQueryClient()
  const { signOut } = useAuth()
  const sessions = useListSessions()
  const revoke = useRevokeSession({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() }) } })
  const revokeAll = useRevokeAllSessions()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices currently signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessions.isLoading && <Loading />}
        <ErrorNote error={sessions.error ?? revoke.error ?? revokeAll.error} />
        {sessions.data?.length === 0 && <Empty>No active sessions.</Empty>}
        <ul className="divide-y rounded-md border">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <p className="font-medium">
                  {describeAgent(s.userAgent)} {s.current && <Badge className="ml-2">This device</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {s.ip} · signed in {dateTime(s.createdAt)} · last active {dateTime(s.lastSeenAt)}
                </p>
              </div>
              {!s.current && (
                <Button size="sm" variant="outline" onClick={() => revoke.mutate({ id: s.id })} disabled={revoke.isPending}>
                  Log out this device
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Button variant="destructive" onClick={() => void revokeAll.mutateAsync().then(() => signOut())} disabled={revokeAll.isPending}>
          Log out everywhere
        </Button>
      </CardContent>
    </Card>
  )
}

const codeSchema = z.object({ code: z.string().trim().length(6, 'Enter the 6-digit code') })
const disableSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
  code: z.string().trim().min(6, 'Enter a code from your app or a backup code'),
})

function TwoFactor() {
  const { user, reload } = useAuth()
  const setup = useSetupMfa()
  const enable = useEnableMfa()
  const disable = useDisableMfa()
  const [details, setDetails] = useState<Setup | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const enableForm = useForm<z.infer<typeof codeSchema>>({ resolver: zodResolver(codeSchema) })
  const disableForm = useForm<z.infer<typeof disableSchema>>({ resolver: zodResolver(disableSchema) })

  async function begin() {
    setError(null)
    try {
      setDetails(await setup.mutateAsync())
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function confirm(values: z.infer<typeof codeSchema>) {
    setError(null)
    try {
      const result = await enable.mutateAsync({ data: values })
      setBackupCodes(result.codes)
      setDetails(null)
      await reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function turnOff(values: z.infer<typeof disableSchema>) {
    setError(null)
    try {
      await disable.mutateAsync({ data: values })
      disableForm.reset()
      await reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>Add a one-time code from an authenticator app to every sign-in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert variant="destructive">{error}</Alert>}

        {backupCodes && (
          <Alert variant="success">
            <p className="font-medium">Two-factor is on. Save these backup codes now, each works once.</p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-foreground" data-testid="backup-codes">
              {backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Alert>
        )}

        {!user?.mfaEnabled && !details && (
          <Button onClick={() => void begin()} disabled={setup.isPending}>
            Set up two-factor
          </Button>
        )}

        {!user?.mfaEnabled && details && (
          <div className="space-y-4">
            <p className="text-sm">Scan this code with Google Authenticator or Authy, then enter the 6-digit code it shows.</p>
            <img src={details.qrCode} alt="QR code for your authenticator app" className="h-44 w-44 rounded bg-white p-2" />
            <p className="text-sm text-muted-foreground">
              Cannot scan? Enter this key manually: <code className="font-mono text-foreground">{details.secret}</code>
            </p>
            <form onSubmit={enableForm.handleSubmit(confirm)} className="flex flex-wrap items-end gap-3" noValidate>
              <div className="space-y-2">
                <Label htmlFor="enable-code">Code from your app</Label>
                <Input id="enable-code" inputMode="numeric" autoComplete="one-time-code" {...enableForm.register('code')} />
                {enableForm.formState.errors.code && <p className="text-sm text-destructive">{enableForm.formState.errors.code.message}</p>}
              </div>
              <Button type="submit">Turn on</Button>
            </form>
          </div>
        )}

        {user?.mfaEnabled && (
          <form onSubmit={disableForm.handleSubmit(turnOff)} className="space-y-3" noValidate>
            <p className="text-sm text-muted-foreground">To turn two-factor off, confirm your password and a current code.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="disable-password">Password</Label>
                <Input id="disable-password" type="password" autoComplete="current-password" {...disableForm.register('password')} />
                {disableForm.formState.errors.password && <p className="text-sm text-destructive">{disableForm.formState.errors.password.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="disable-code">Code</Label>
                <Input id="disable-code" autoComplete="one-time-code" {...disableForm.register('code')} />
                {disableForm.formState.errors.code && <p className="text-sm text-destructive">{disableForm.formState.errors.code.message}</p>}
              </div>
            </div>
            <Button type="submit" variant="outline">
              Turn off two-factor
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

export default function AccountPage() {
  return (
    <>
      <PageHeader title="Account" description="Manage where you are signed in and how you sign in." />
      <div className="space-y-6">
        <Sessions />
        <TwoFactor />
      </div>
    </>
  )
}
