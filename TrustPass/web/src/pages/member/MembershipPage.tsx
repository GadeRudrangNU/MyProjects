import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { errorCode, errorMessage } from '@/api/client'
import {
  getListMyPaymentsQueryKey,
  getListMySubscriptionsQueryKey,
  useCancelSubscription,
  useListMyPayments,
  useListMySubscriptions,
  useListPlans,
  useRenewSubscription,
  useSubscribe,
} from '@/api/generated/trustpass'
import type { PlanView } from '@/api/generated/model'
import { Empty, ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/common'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateTime, money, newIdempotencyKey } from '@/lib/format'

export default function MembershipPage() {
  const queryClient = useQueryClient()
  const plans = useListPlans()
  const subscriptions = useListMySubscriptions()
  const payments = useListMyPayments()
  const [attemptKey, setAttemptKey] = useState(newIdempotencyKey)
  const idempotency = { request: { headers: { 'Idempotency-Key': attemptKey } } }
  const subscribe = useSubscribe(idempotency)
  const renew = useRenewSubscription(idempotency)
  const cancel = useCancelSubscription()
  const [notice, setNotice] = useState<{ kind: 'success' | 'destructive'; text: string } | null>(null)

  const active = subscriptions.data?.find((s) => s.status === 'ACTIVE')

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListMySubscriptionsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListMyPaymentsQueryKey() }),
    ])
  }

  async function run(action: () => Promise<{ status: string; failureReason?: string }>) {
    setNotice(null)
    try {
      const result = await action()
      setAttemptKey(newIdempotencyKey())
      setNotice(
        result.status === 'SUCCEEDED'
          ? { kind: 'success', text: 'Payment received. Your membership is active.' }
          : { kind: 'destructive', text: `Payment was declined (${result.failureReason ?? 'unknown'}). You were not charged.` },
      )
    } catch (error) {
      const code = errorCode(error)
      if (code === 'PAYMENT_PROVIDER_UNAVAILABLE' || !code) {
        setNotice({ kind: 'destructive', text: `${errorMessage(error)} You can press the button again safely.` })
      } else {
        setAttemptKey(newIdempotencyKey())
        setNotice({ kind: 'destructive', text: errorMessage(error) })
      }
    }
    await refresh()
  }

  async function choose(plan: PlanView) {
    await run(async () => {
      try {
        return await subscribe.mutateAsync({ data: { planCode: plan.code } })
      } catch (error) {
        const declined = (error as { response?: { status?: number; data?: { status: string; failureReason?: string } } }).response
        if (declined?.status === 402 && declined.data) {
          return declined.data
        }
        throw error
      }
    })
  }

  return (
    <>
      <PageHeader title="Membership" description="Plans are billed every 30 days through a mock payment provider that sometimes fails on purpose." />
      <div className="space-y-6">
        {notice && <Alert variant={notice.kind}>{notice.text}</Alert>}
        <ErrorNote error={plans.error ?? subscriptions.error ?? cancel.error} />

        {active && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                {active.planName} <StatusBadge status={active.status} />
              </CardTitle>
              <CardDescription>Current period ends {dateTime(active.currentPeriodEnd)}.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                disabled={renew.isPending}
                onClick={() =>
                  void run(async () => {
                    try {
                      return await renew.mutateAsync({ id: active.id })
                    } catch (error) {
                      const declined = (error as { response?: { status?: number; data?: { status: string; failureReason?: string } } }).response
                      if (declined?.status === 402 && declined.data) return declined.data
                      throw error
                    }
                  })
                }
              >
                Renew now
              </Button>
              <Button
                variant="outline"
                disabled={cancel.isPending}
                onClick={() => void cancel.mutateAsync({ id: active.id }).then(refresh)}
              >
                Cancel membership
              </Button>
            </CardContent>
          </Card>
        )}

        {!active && (
          <section aria-labelledby="plans-heading">
            <h2 id="plans-heading" className="mb-3 text-lg font-semibold">
              Choose a plan
            </h2>
            {plans.isLoading && <Loading />}
            <div className="grid gap-4 md:grid-cols-2">
              {plans.data?.map((plan) => (
                <Card key={plan.id}>
                  <CardHeader>
                    <CardTitle>{plan.name}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-3xl font-semibold">
                      {money(plan.priceCents)} <span className="text-base font-normal text-muted-foreground">/ {plan.periodDays} days</span>
                    </p>
                    <Button onClick={() => void choose(plan)} disabled={subscribe.isPending} aria-label={`Subscribe to ${plan.name}`}>
                      {subscribe.isPending ? 'Processing…' : `Subscribe to ${plan.name}`}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Billing history</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.isLoading && <Loading />}
            {payments.data?.length === 0 && <Empty>No payments yet.</Empty>}
            {(payments.data?.length ?? 0) > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.data?.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{dateTime(p.createdAt)}</TableCell>
                      <TableCell>{p.kind === 'RENEW' ? 'Renewal' : 'Subscription'}</TableCell>
                      <TableCell>{money(p.amountCents)}</TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                        {p.failureReason && <span className="ml-2 text-xs text-muted-foreground">{p.failureReason}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
