import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { errorMessage } from '@/api/client'
import { verifyEmail } from '@/api/generated/trustpass'
import { PublicLayout } from '@/components/AppLayout'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const attempts = new Map<string, Promise<unknown>>()

function verifyOnce(token: string) {
  let attempt = attempts.get(token)
  if (!attempt) {
    attempt = verifyEmail({ token })
    attempts.set(token, attempt)
  }
  return attempt
}

type Outcome = { state: 'working' } | { state: 'verified' } | { state: 'failed'; message: string }

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [outcome, setOutcome] = useState<Outcome>({ state: 'working' })

  useEffect(() => {
    if (!token) return
    let active = true
    verifyOnce(token)
      .then(() => active && setOutcome({ state: 'verified' }))
      .catch((error: unknown) => active && setOutcome({ state: 'failed', message: errorMessage(error) }))
    return () => {
      active = false
    }
  }, [token])

  return (
    <PublicLayout>
      <Card>
        <CardHeader>
          <CardTitle>Email verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token && <Alert variant="destructive">This link is missing its token.</Alert>}
          {token && outcome.state === 'working' && <p role="status">Verifying your email…</p>}
          {outcome.state === 'verified' && (
            <>
              <Alert variant="success">Your email address is verified. You can sign in now.</Alert>
              <Button asChild className="w-full">
                <Link to="/login">Go to sign in</Link>
              </Button>
            </>
          )}
          {outcome.state === 'failed' && (
            <>
              <Alert variant="destructive">{outcome.message}</Alert>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">Back to sign in</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </PublicLayout>
  )
}
