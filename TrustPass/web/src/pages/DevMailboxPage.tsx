import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PublicLayout } from '@/components/AppLayout'
import { Empty, ErrorNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { dateTime } from '@/lib/format'

const MAIL_URL: string = import.meta.env.VITE_MAIL_URL ?? 'http://localhost:8081'

interface Mail {
  to: string
  from: string
  subject: string
  body: string
  sentAt: string
}

function linkify(body: string) {
  return body.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="break-all text-primary underline">
        {part}
      </a>
    ) : (
      part
    ),
  )
}

export default function DevMailboxPage() {
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState(params.get('to') ?? '')
  const to = params.get('to') ?? ''
  const inbox = useQuery({
    queryKey: ['dev-mail', to],
    queryFn: async () => (await axios.get<Mail[]>(`${MAIL_URL}/dev/mail`, { params: to ? { to } : {} })).data,
    refetchInterval: 2000,
  })

  return (
    <PublicLayout>
      <div className="-mx-4 w-screen max-w-2xl px-4 sm:mx-0 sm:w-full">
        <Card>
          <CardHeader>
            <CardTitle>Development mailbox</CardTitle>
            <CardDescription>Every email TrustPass sends lands here instead of the internet. This page is only for local development.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                setParams(draft ? { to: draft } : {})
              }}
            >
              <div className="flex-1 space-y-2">
                <Label htmlFor="to">Show messages for</Label>
                <Input id="to" type="email" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="everyone" />
              </div>
              <Button type="submit" variant="outline">
                Filter
              </Button>
            </form>
            <ErrorNote error={inbox.error} fallback="The worker is not reachable on the mail port." />
            {inbox.data?.length === 0 && <Empty>No messages yet.</Empty>}
            <ul className="space-y-3">
              {inbox.data?.map((mail, index) => (
                <li key={`${mail.sentAt}-${index}`} className="rounded-md border p-3" data-testid="mail">
                  <p className="font-medium">{mail.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    To {mail.to} · {dateTime(mail.sentAt)}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{linkify(mail.body)}</pre>
                </li>
              ))}
            </ul>
            <Link to="/login" className="text-sm text-primary underline">
              Back to sign in
            </Link>
          </CardContent>
        </Card>
      </div>
    </PublicLayout>
  )
}
