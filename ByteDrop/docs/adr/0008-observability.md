# 0008. Logs, metrics and traces: what is recorded and why

Status: Accepted

## Context

Someone will be paged for this service. The first questions are always the same: is it up, is it slow, is something piling
up, and which request was that?

## Decision

- **Logs.** `pino` JSON on stdout. Every request log line carries `reqId` (taken from `X-Request-Id` when the caller sends
  one, generated otherwise, and returned in the response and in error bodies) and, outside the hot paths, `traceId`.
  `Authorization`, cookies and API-key headers are redacted. File delivery logs only warnings and above; deliveries are
  recorded as analytics events instead.
- **Health.** `/health` says the process is running. `/ready` checks the database with `select 1` and the disk by writing and
  reading a probe file; it answers `503` with the failing check named. The worker has the same endpoints on its own port.
- **Metrics.** `prom-client` at `/metrics` on both processes: request duration histogram by route, method and status; cache
  outcomes by layer (`transform`: hit, miss, coalesced; `etag`: not_modified, full); upload failures by reason; transform
  cache bytes; webhook backlog (the number of deliveries still pending, read from the database at scrape time); webhook attempt
  outcomes and receiver response time; job duration and job failures by queue; events waiting to be flushed; plus the default
  Node process metrics.
- **Traces.** OpenTelemetry. Each request is a span that continues an incoming `traceparent`. The trace context is written into
  job payloads and the outbox, and the worker starts its spans from it, so a request, the thumbnail job it queued and the
  webhook delivery it caused share one trace id. Spans go to an OTLP endpoint when `OTEL_EXPORTER_OTLP_ENDPOINT` is set and to
  stdout with `TRACE_STDOUT=1`. Probe routes are not traced.

## Consequences

- The three most useful graphs exist from day one: latency by route, webhook backlog, job failures.
- Tests assert the behaviour (request ids on log lines, trace ids across the queue, 503 when the disk fails), not just that
  the code runs.
- Metrics are per process, so alerts should be defined per job name and per instance.

## Alternatives considered

- **Auto-instrumentation packages.** Broader, but they pull in a lot of code for spans this service does not need and make the
  queue hand-off less explicit.
