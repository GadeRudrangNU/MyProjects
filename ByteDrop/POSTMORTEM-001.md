# Postmortem 001: one unresponsive webhook receiver delayed everyone's events

**Status:** resolved  **Severity:** SEV-3 (delayed, not lost, events)  **Type:** staged incident, reproduced on purpose

This incident was caused deliberately, in a test environment, with the real delivery pipeline: PostgreSQL, the outbox relay,
the pg-boss worker and two HTTP receivers. The numbers below are measurements from `pnpm incident`
(`apps/api/scripts/incident-001.ts`, raw data in [docs/incident-001-data.json](docs/incident-001-data.json)), not estimates.
What was staged is the failure mode itself: the "before" run uses the configuration a straightforward implementation would
have (a long receiver timeout and no circuit breaker), which the service can still be run with through environment
variables. The mitigations were therefore built in knowingly, and this exercise is what measured them and wrote down how an
on-call engineer would recognise the problem.

## Summary

In the staged scenario, webhook delivery to a customer's healthy server was delayed by **up to 97 seconds** because a
*different* customer's receiver had stopped answering. The unresponsive receiver held the worker's delivery slots until its request timeout fired,
and every delivery waiting behind it queued up. Nothing was lost; every event was delivered in the end. After the fix the
same load delivered everything in **14.7 seconds** and the unresponsive receiver received **4** attempts instead of **25**.

## Impact

Under the test load (24 file uploads at five per second, two subscribed endpoints):

| | Before | After |
|-|-------:|------:|
| Time until the healthy endpoint had all 24 events | 103.2 s | 14.7 s |
| Delivery lag on the healthy endpoint, p50 | 48.9 s | 5.4 s |
| Delivery lag on the healthy endpoint, p95 | 89.4 s | 8.0 s |
| Delivery lag on the healthy endpoint, max | 97.0 s | 8.3 s |
| Peak webhook backlog | 47 | 40 |
| Attempts made to the unresponsive receiver | 25 | 4 |
| Attempts that timed out | 23 | 4 |

A real customer would have seen events arrive minutes late, and a larger event rate would have grown the delay without bound,
since each second of the stuck receiver consumed delivery capacity faster than events arrived.

## Timeline (test run, seconds from the first upload)

| t | What happened |
|---|---------------|
| 0 | Uploads begin. Each creates two deliveries: one for the unresponsive receiver, one for the healthy one. The unresponsive endpoint is registered first, so it is first in line |
| 6 | Backlog reaches 47 pending deliveries. Only one healthy delivery has completed. Two slots are occupied by requests that will not be answered for eight seconds |
| 43 | Ten of 24 healthy deliveries done. Backlog 38 and falling slowly: the system is draining at the rate of two timeouts per eight seconds |
| 99 | 23 of 24 done |
| 103 | The last healthy delivery completes |

## Detection

The signals that showed it, all present in `/metrics` on the worker (`:4001`):

1. **`bytedrop_webhook_backlog`** rose to 47 within six seconds and fell by about one delivery every two seconds. A backlog
   that rises and then drains *slowly* means throughput collapsed rather than load spiking.
2. **`bytedrop_webhook_attempt_duration_seconds`** had every slow sample in the last bucket, at exactly the timeout. Real
   slowness has a spread; a wall at a round number is a timeout.
3. **`bytedrop_webhook_attempts_total{outcome="timeout"}`** was 23 against 24 successes: nearly half of all attempts were
   spent waiting for one receiver.
4. The delivery log showed the cause directly: one endpoint with `lastError: "timed out after …ms"` on every row, and
   healthy endpoint rows whose `created_at` and success time were a minute apart.

The first symptom a person would notice is the dashboard's delivery log, where healthy rows show large gaps between creation
and completion.

## Root cause

Three behaviours combined in the "before" configuration:

1. **A long receiver timeout** (eight seconds in the staged run, scaled down from the thirty a naive default would use). That
   is far longer than any reasonable response time, so one silent receiver held a slot for the whole period.
2. **Shared, small delivery capacity.** Two slots served all endpoints. A receiver that never answers needs no CPU and no
   bandwidth, only a slot, so it starves everyone else at almost no cost to itself.
3. **No memory of failure.** Every new delivery for the unresponsive endpoint was attempted at full price, even though the
   previous twenty had just timed out.

A contributing factor: the unresponsive endpoint's deliveries were ahead of the healthy ones in the queue, which is the
worst ordering and entirely ordinary in production (endpoints are registered at different times).

## Resolution

Two mitigations, both in `apps/api/src/services/webhooks.ts` and both covered by tests, are what the service ships with and
what the "after" run enables:

1. **Bounded receiver timeout:** 5 seconds in production defaults (`WEBHOOK_TIMEOUT_MS`), 1 second in the "after" run to
   keep the demonstration short.
2. **Per-endpoint circuit breaker.** After five consecutive failures (three in the staged run) the endpoint is "open" for 30
   seconds. A delivery for an open endpoint is rescheduled for when the breaker closes, *without being sent and without
   occupying a slot*. Healthy endpoints no longer queue behind it.

Retries for the failing endpoint continue with exponential backoff up to six attempts, and the delivery log and Replay button
remain the way to recover once the customer fixes their server. The breaker state is exposed indirectly through the
`timeout` attempt counter, which stops growing.

## What went well

- The outbox kept every event; nothing was lost, only late.
- The metrics were enough to find the cause without reading code.
- The failure reproduces with one command, so the fix has a before/after number.

## What went badly

- The failure needed only two ordinary settings, and nothing in the system would have flagged them as risky: a receiver that
  accepts a connection and never replies is the case a timeout exists for, and it is easy to size the timeout for the
  average case instead.
- There is still no alert on backlog size or on the share of attempts that time out, because alerting needs a Prometheus
  server that this free, single-machine setup does not run.
- Remaining latency after the fix (about eight seconds at the tail) is bounded by queue polling: each worker slot polls every
  half second and takes one job. That is acceptable for webhooks but is the next bottleneck.

## Action items

| Action | Status |
|--------|--------|
| Shorter timeout and circuit breaker | Done |
| Regression tests: retries and backoff, breaker, timeout, replay (`apps/api/test/webhooks.test.ts`) | Done |
| Metrics for backlog, attempt outcome and receiver response time | Done |
| Runbook section "The webhook backlog is growing" ([RUNBOOK.md](RUNBOOK.md#3-the-webhook-backlog-is-growing)) | Done |
| Alert when `bytedrop_webhook_backlog` stays above a threshold for five minutes, and when more than 20% of attempts time out | Open (needs a Prometheus to run it) |
| Fetch several jobs per poll for the webhook queue to cut the polling floor | Open |
| Per-endpoint concurrency limit, so one endpoint can use at most half the slots even when it is healthy | Open |
| Surface "circuit open" on the endpoint in the dashboard | Open |

## Reproduce it

```bash
pnpm incident
```

The script starts its own PostgreSQL, runs the delivery pipeline twice with the two settings, and writes
`docs/incident-001-data.json`. It takes about three minutes, most of it the "before" run waiting on timeouts.
