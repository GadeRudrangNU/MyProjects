import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { API_URL, errorCode, errorMessage } from '@/api/client'
import { useListProviders, useLogin, useResendVerification } from '@/api/generated/trustpass'
import { useAuth } from '@/auth/AuthContext'
import { PublicLayout } from '@/components/AppLayout'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const schema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})
type Values = z.infer<typeof schema>

const OAUTH_ERRORS: Record<string, string> = {
  oauth_failed: 'Sign-in with that provider did not complete. Please try again.',
  unverified_email: 'That provider has not verified your email address, so we cannot use it to sign you in.',
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn } = useAuth()
  const login = useLogin()
  const resend = useResendVerification()
  const providers = useListProviders()
  const [formError, setFormError] = useState<string | null>(null)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [resent, setResent] = useState(false)
  const from = (location.state as { from?: string } | null)?.from ?? '/app'
  const oauthError = OAUTH_ERRORS[new URLSearchParams(location.search).get('error') ?? '']

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  async function onSubmit(values: Values) {
    setFormError(null)
    setNeedsVerification(false)
    try {
      const response = await login.mutateAsync({ data: values })
      if (response.status === 'MFA_REQUIRED' && response.mfaToken) {
        navigate('/login/mfa', { state: { mfaToken: response.mfaToken, from } })
        return
      }
      if (response.accessToken && response.user) {
        signIn(response.accessToken, response.user)
        navigate(from, { replace: true })
      }
    } catch (error) {
      setNeedsVerification(errorCode(error) === 'EMAIL_NOT_VERIFIED')
      setFormError(errorMessage(error))
    }
  }

  async function resendLink() {
    await resend.mutateAsync({ data: { email: getValues('email') } })
    setResent(true)
  }

  return (
    <PublicLayout>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Welcome back. Use your email and password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {oauthError && <Alert variant="destructive">{oauthError}</Alert>}
            {formError && <Alert variant="destructive">{formError}</Alert>}
            {needsVerification && (
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => void resendLink()} disabled={resent}>
                  {resent ? 'Verification email sent' : 'Send the verification email again'}
                </Button>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} {...register('email')} />
              {errors.email && (
                <p id="email-error" className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined} {...register('password')} />
              {errors.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {(providers.data?.length ?? 0) > 0 && (
            <div className="mt-6 space-y-2 border-t pt-6">
              <p className="text-center text-sm text-muted-foreground">Or continue with</p>
              {providers.data?.map((provider) => (
                <Button key={provider.id} asChild variant="outline" className="w-full">
                  <a href={`${API_URL}/oauth2/authorization/${provider.id}`}>{provider.name}</a>
                </Button>
              ))}
            </div>
          )}
          <p className="mt-6 text-center text-sm text-muted-foreground">
            New to TrustPass?{' '}
            <Link to="/signup" className="text-primary underline">
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </PublicLayout>
  )
}
