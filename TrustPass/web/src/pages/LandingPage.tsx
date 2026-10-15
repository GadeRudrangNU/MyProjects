import { Fingerprint, CalendarCheck, ShieldCheck } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { FullPageSpinner } from '@/auth/guards'
import { Button } from '@/components/ui/button'

const features = [
  { icon: Fingerprint, title: 'Verify once', text: 'Enroll, confirm your email and verify a government ID. Sensitive fields are encrypted at rest.' },
  { icon: ShieldCheck, title: 'Share a yes or no', text: 'Partner apps can ask whether you are a verified adult without ever seeing your date of birth.' },
  { icon: CalendarCheck, title: 'Book in seconds', text: 'Hold a membership, reserve a slot, and take a spot from the waitlist the moment one opens.' },
]

export default function LandingPage() {
  const { status } = useAuth()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'authenticated') return <Navigate to="/app" replace />

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xl font-semibold">
          <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
          TrustPass
        </span>
        <nav className="flex gap-2" aria-label="Account">
          <Button asChild variant="ghost">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/signup">Create account</Link>
          </Button>
        </nav>
      </header>
      <main className="flex flex-1 flex-col justify-center">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">One identity for memberships and bookings.</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          TrustPass lets people enroll, prove who they are, hold a membership and book time, with the privacy guarantees you would expect from an identity service.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild size="lg">
            <Link to="/signup">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/login">I have an account</Link>
          </Button>
        </div>
        <ul className="mt-14 grid gap-6 sm:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-lg border bg-card p-5">
              <Icon className="mb-3 h-6 w-6 text-primary" aria-hidden="true" />
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
