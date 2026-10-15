import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { errorMessage } from '@/api/client'
import { useVerifyMfa } from '@/api/generated/trustpass'
import { useAuth } from '@/auth/AuthContext'
import { PublicLayout } from '@/components/AppLayout'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const schema = z.object({ code: z.string().trim().min(6, 'Enter the 6-digit code or a backup code') })
type Values = z.infer<typeof schema>

export default function MfaPage() {
  const location = useLocation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const verify = useVerifyMfa()
  const [formError, setFormError] = useState<string | null>(null)
  const state = location.state as { mfaToken?: string; from?: string } | null
  const mfaToken = state?.mfaToken ?? params.get('token') ?? undefined

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  if (!mfaToken) return <Navigate to="/login" replace />

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      const response = await verify.mutateAsync({ data: { mfaToken: mfaToken as string, code: values.code } })
      if (response.accessToken && response.user) {
        signIn(response.accessToken, response.user)
        navigate(state?.from ?? '/app', { replace: true })
      }
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <PublicLayout>
      <Card>
        <CardHeader>
          <CardTitle>Two-factor code</CardTitle>
          <CardDescription>Open your authenticator app and enter the 6-digit code, or use one of your backup codes.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {formError && <Alert variant="destructive">{formError}</Alert>}
            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input id="code" inputMode="text" autoComplete="one-time-code" autoFocus aria-invalid={!!errors.code} {...register('code')} />
              {errors.code && <p className="text-sm text-destructive">{errors.code.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              Verify
            </Button>
          </form>
        </CardContent>
      </Card>
    </PublicLayout>
  )
}
