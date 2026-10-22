# 0006. Webhooks through a transactional outbox, with retries, a log and a circuit breaker

Status: Accepted

## Context

Customers want a signed HTTP call when files change. Two things must hold: an event is sent if and only if the change
committed, and a misbehaving receiver must not hurt anybody else's deliveries. The second one was learned the hard way, see
[POSTMORTEM-001](../../POSTMORTEM-001.md).

## Decision

- **Outbox.** The route that changes data (`object.created`, `object.deleted`, `upload.failed`) inserts an `outbox` row in
  the same transaction. No commit, no event; no event without a commit.
- **Relay.** The worker polls the outbox (a partial index on undelivered rows keeps that cheap), turns each row into one
  `webhook_deliveries` row per active endpoint that subscribed to the event type, and enqueues one `webhook.deliver` job per
  delivery, all inside one database transaction (pg-boss accepts a transaction handle). A crash cannot lose or duplicate work.
- **Delivery.** A `POST` with a JSON body and a `ByteDrop-Signature: t=<unix>,v1=<hex>` header, where `v1` is
  `HMAC-SHA256(secret, "<t>.<body>")`. Redirects are not followed. A response in the 2xx range is success.
- **Retries.** Failures are rescheduled as new jobs with exponential backoff (`base × 2^(attempt-1)`, jittered, capped at an
  hour) up to six attempts, then the delivery is marked `failed`. The log keeps status, last status code, response time,
  attempt count and error text for every delivery.
- **Replay.** `POST .../deliveries/:id/replay` resets a delivery and enqueues it again. The dashboard shows the button on
  failed rows.
- **Isolation.** Receiver timeout defaults to five seconds. Each endpoint has a circuit breaker: after five consecutive
  failures it opens for 30 seconds, and deliveries for it are deferred without being sent and without using a delivery slot.
  Healthy endpoints keep their throughput.
- **Traces.** The outbox row stores the trace context of the request that caused it, so the delivery job shows up in the same
  trace.
- The signing secret is shown once, when the endpoint is created. In production, endpoint URLs that point at private
  addresses are rejected.

## Consequences

- At-least-once delivery: receivers should treat the `id` in the payload (the delivery id) as an idempotency key.
- The breaker state lives in the worker process. With several workers each learns on its own, which is acceptable because
  the timeout bounds the damage either way.
- Delivery latency is bounded below by the outbox poll (0.5 s) plus queue polling.

## Alternatives considered

- **Send inside the request handler.** Couples user latency to someone else's server and loses events on crashes.
- **Publish to the queue directly after commit.** A crash between the commit and the publish loses the event; the outbox
  removes that window.
