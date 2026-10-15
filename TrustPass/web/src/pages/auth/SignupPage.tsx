import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { errorMessage } from '@/api/client'
import { useSignup } from '@/api/generated/trustpass'
import { PublicLayout } from '@/components/AppLayout'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const passwordRules = [
  { label: 'At least 10 characters', test: (v: string) => v.length >= 10 },
  { label: 'An uppercase and a lowercase letter', test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { label: 'A number', test: (v: string) => /\d/.test(v) },
  { label: 'A symbol', test: (v: string) => /[^A-Za-z0-9\s]/.test(v) },
]

const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z
    .string()
    .min(1, 'Choose a password')
    .refine((v) => passwordRules.every((r) => r.test(v)), 'The password does not meet every requirement'),
})
type Values = z.infer<typeof schema>

export default function SignupPage() {
  const signup = useSignup()
  const [formError, setFormError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '' } })
  const password = watch('password')

  async function onSubmit(values: Values) {
    setFormError(null)
    try {
      await signup.mutateAsync({ data: values })
      setSentTo(values.email)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  if (sentTo) {
    return (
      <PublicLayout>
        <Card>
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              If {sentTo} can be used, a verification link is on its way. It expires in 24 hours.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {import.meta.env.DEV && (
              <Button asChild variant="outline">
                <Link to={`/dev/mailbox?to=${encodeURIComponent(sentTo)}`}>Open the development mailbox</Link>
              </Button>
            )}
            <p className="text-sm text-muted-foreground">
              Already verified?{' '}
              <Link to="/login" className="text-primary underline">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout>
      <Card>
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>One identity for enrolling, memberships and bookings.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {formError && <Alert variant="destructive">{formError}</Alert>}
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" autoComplete="name" aria-invalid={!!errors.name} {...register('name')} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="new-password" aria-describedby="password-rules" aria-invalid={!!errors.password} {...register('password')} />
              <ul id="password-rules" className="space-y-1 text-xs">
                {passwordRules.map((rule) => (
                  <li key={rule.label} className={rule.test(password) ? 'text-success' : 'text-muted-foreground'}>
                    {rule.test(password) ? '✓' : '•'} {rule.label}
                  </li>
                ))}
              </ul>
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="text-primary underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </PublicLayout>
  )
}
