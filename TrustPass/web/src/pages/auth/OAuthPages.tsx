import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { errorMessage } from '@/api/client'
import { useConfirmOAuthLink } from '@/api/generated/trustpass'
import { useAuth } from '@/auth/AuthContext'
import { FullPageSpinner } from '@/auth/guards'
import { PublicLayout } from '@/components/AppLayout'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function OAuthCallbackPage() {
  const { adoptSession } = useAuth()
  const navigate = useNavigate()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void adoptSession().then((ok) => navigate(ok ? '/app' : '/login?error=oauth_failed', { replace: true }))
  }, [adoptSession, navigate])

  return <FullPageSpinner />
}

const schema = z.object({ password: z.string().min(1, 'Enter your TrustPass password') })
type Values = z.infer<typeof schema>

export function OAuthLinkPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const provider = params.get('provider') ?? 'that provider'
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const link = useConfirmOAuthLink()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  if (!token) return <Navigate to="/login" replace />

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      const response = await link.mutateAsync({ data: { linkToken: token as string, password: values.password } })
      if (response.status === 'MFA_REQUIRED' && response.mfaToken) {
        navigate('/login/mfa', { state: { mfaToken: response.mfaToken } })
      } else if (response.accessToken && response.user) {
        signIn(response.accessToken, response.user)
        navigate('/app', { replace: true })
      }
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <PublicLayout>
      <Card>
        <CardHeader>
          <CardTitle>Link your account</CardTitle>
          <CardDescription>
            A TrustPass account already exists for the email address on your {provider} account. Enter your password to
            confirm it is yours and connect the two.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {formError && <Alert variant="destructive">{formError}</Alert>}
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register('password')} />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              Confirm and link
            </Button>
          </form>
        </CardContent>
      </Card>
    </PublicLayout>
  )
}
