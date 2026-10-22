# Runbook

How to find out what is wrong with ByteDrop and what to do about it. Written for whoever is on call, so it starts with the
two-minute triage and then goes symptom by symptom.

Everything here works against a local stack and against a deployed one; only the hostnames change. The API listens on
`:4000`, the worker's health and metrics port is `:4001`.

## 1. Two-minute triage

Run these first, in this order.

```bash
curl -s localhost:4000/health        # {"status":"ok"} : the process is up
curl -s localhost:4000/ready         # {"status":"ready"} : database and disk both answer
curl -s localhost:4001/ready         # same for the worker
pnpm --filter @bytedrop/api ops stats
```

| Result | Meaning | Go to |
|--------|---------|-------|
| `/health` does not answer | API process is down or wedged | [7](#7-the-api-or-worker-is-down) |
| `/ready` is `503` with `database` failing | PostgreSQL unreachable or out of connections | [6](#6-database-trouble) |
| `/ready` is `503` with `disk` failing | Data directory full or read-only | [4](#4-the-disk-is-full) |
| `ops stats` shows pending deliveries climbing | Webhook backlog | [3](#3-the-webhook-backlog-is-growing) |
| Users report slow downloads | Delivery latency | [2](#2-deliveries-are-slow) |
| Uploads fail | Upload errors | [5](#5-uploads-are-failing) |

Every error body and every response carries a request id. Ask the reporter for it (`x-request-id` header, or
`error.requestId` in the JSON), then:

```bash
grep '"reqId":"<id>"' api.log        # all log lines for that request, with its traceId
```

If tracing is on (`OTEL_EXPORTER_OTLP_ENDPOINT` or `TRACE_STDOUT=1`), the `traceId` on those lines finds the request, any
background job it queued and any webhook it caused, as one trace.

## 2. Deliveries are slow

Symptoms: p95 on the dashboard rises, downloads stall, `bytedrop_http_request_duration_seconds` for the route
`/f/:bucket/*` shifts right.

1. **Is it all requests or one kind?** Look at the histogram by status and query shape. `curl -s localhost:4000/metrics |
   grep 'route="/f/:bucket/\*"'`.
2. **Image transforms.** `bytedrop_cache_events_total{layer="transform"}`:
   - many `miss`, few `hit`: the cache is cold or too small. `bytedrop_transform_cache_bytes` sitting at the limit
     (`TRANSFORM_CACHE_BYTES`, default 256 MB) means variants are evicting each other; raise the limit.
   - lots of `coalesced`: a burst for one new variant is being absorbed; that is the system working.
   - CPU pinned with `miss` high: renders are queued behind the limit of four at a time. Clients requesting unbounded
     width/quality combinations are the usual cause; consider restricting the allowed widths at your edge.
3. **Plain files.** `bytedrop_cache_events_total{layer="etag"}`: a healthy ratio is mostly `not_modified`. If it is mostly
   `full`, clients are not revalidating; check that something in front is not stripping `ETag` or `If-None-Match`.
4. **Disk.** On the host, check disk latency. Files under 512 KB are served from memory after the first read, so slow
   disks show up first on large files and cold small files.
5. **Database.** Delivery does one metadata lookup (cached for one second, collapsed across concurrent requests). If
   `/ready` is slow or the pool is exhausted, see [6](#6-database-trouble).
6. **Analytics buffer.** `bytedrop_analytics_buffered_events` should hover near zero. If it grows, the database is not
   keeping up with event batches; delivery itself is not affected, but events will be dropped if the process dies.

Quick relief: restart does not help, caches are rebuilt on demand. If one tenant is causing it, revoke their API key
(`DELETE /v1/projects/:id/keys/:keyId`) or make the bucket private.

## 3. The webhook backlog is growing

Symptom: `bytedrop_webhook_backlog` rises and stays up, or customers say events arrive late. This is the failure described
in [POSTMORTEM-001](POSTMORTEM-001.md).

```bash
curl -s localhost:4001/metrics | grep -E 'webhook_(backlog|attempts_total|attempt_duration)'
pnpm --filter @bytedrop/api ops stats      # pending / failed deliveries and undelivered outbox rows
```

Read the numbers:

- **`bytedrop_webhook_attempts_total{outcome="timeout"}` climbing:** a receiver is not answering. The attempt-duration
  histogram will show a pile in the last bucket (the timeout, five seconds by default).
- **`outcome="http_error"`:** a receiver is answering with errors. Look at `lastStatusCode` in the delivery log.
- **`outcome="network_error"`:** DNS or connection failures.
- **Backlog high, attempts flat or zero:** the worker is not running, or the relay is not draining the outbox. Check
  `localhost:4001/ready`, then `ops stats` for undelivered outbox rows, then run `pnpm --filter @bytedrop/api ops relay`.

Find the offender:

```sql
select e.url, count(*) filter (where d.status = 'pending') as pending,
       count(*) filter (where d.status = 'failed') as failed, max(d.last_error) as last_error
  from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id
 group by e.url order by pending desc;
```

What the system already does for you: a receiver that fails five times in a row gets a 30-second circuit breaker, so it
stops using delivery slots; every delivery has a bounded timeout; retries back off exponentially for six attempts and then
the delivery is marked `failed`. Healthy endpoints should be unaffected within seconds. If they are not, check that
`WEBHOOK_BREAKER` is `on` and `WEBHOOK_TIMEOUT_MS` is small (the settings the incident was caused by were a long timeout and
the breaker off).

Actions:

1. Tell the customer which endpoint is failing and what it returns.
2. If the endpoint is permanently gone, remove it (`DELETE /v1/projects/:id/webhooks/:webhookId`). Its deliveries,
   pending ones included, are removed with it and stop consuming slots.
3. After they fix it, replay from the dashboard's Webhooks page (the Replay button on failed rows) or
   `POST /v1/projects/:id/webhooks/deliveries/:deliveryId/replay`.

## 4. The disk is full

Symptoms: `/ready` reports `disk` failing, uploads return 500, `ENOSPC` in logs.

```bash
pnpm --filter @bytedrop/api ops stats
```

The output separates the four things that use the data directory:

| Line | What it is | Safe to free? |
|------|------------|---------------|
| `blobs on disk` | Customer files | No. Only garbage collection may remove them |
| `blobs with no owner` | Deleted content waiting for the grace period | Yes: `ops gc --grace-ms 0` |
| `transform cache` | Rendered image variants | Yes. It is an LRU; deleting `cache/` costs a re-render |
| `upload scratch space` | Partial uploads in `tmp/` | Expired sessions are cleaned by the maintenance job; `ops gc` runs it now |

Steps, in order of risk:

1. `pnpm --filter @bytedrop/api ops gc --grace-ms 0` to release deleted content immediately.
2. Lower `TRANSFORM_CACHE_BYTES` and restart, or delete the `cache/` directory.
3. If `blobs on disk` itself is the growth, find the heavy projects:
   `select p.name, p.used_bytes, p.quota_bytes from projects p order by used_bytes desc limit 10;` Lower a quota with an
   `update projects set quota_bytes = ...`; uploads past it return `413 quota_exceeded`.
4. Add disk (or move the data directory) and restart.

Prevent it: alert at 80% disk use, and keep per-project quotas.

## 5. Uploads are failing

`bytedrop_upload_failures_total` is labelled by reason:

| `reason` | Cause | Action |
|----------|-------|--------|
| `chunk_hash_mismatch` | Corruption in transit (proxy rewriting bodies, bad client) | Client retries the chunk; look for a proxy compressing or altering `application/octet-stream` |
| `hash_mismatch` | The assembled file does not match the declared SHA-256 | The client hashed a different file than it sent; the session is failed and an `upload.failed` event is sent |
| `quota_exceeded` | Project is over quota | Raise the quota or have the customer delete files |
| `expired` | Session older than 24 hours | Client starts a new session |
| `error` / 5xx | Server side | Check logs by request id; check disk ([4](#4-the-disk-is-full)) |

A client that lost its connection should call `GET /v1/projects/:id/uploads/:uploadId`, read `offset`, and continue from
there. If it receives `409 offset_mismatch`, the body contains `currentOffset`.

## 6. Database trouble

- `/ready` fails on `database`: confirm PostgreSQL is up and `DATABASE_URL` is right. For the embedded development
  database, the data lives in `.data/pg`; a stale `postmaster.pid` after a hard kill is removed by PostgreSQL on start.
- Connection pool exhausted (requests hang, then time out): the API pool is 12 connections, the worker's is 8, pg-boss uses 4
  more per process. Long-running queries are the usual cause: `select pid, now() - query_start as age, query from
  pg_stat_activity where state <> 'idle' order by age desc;`
- Migrations: the API applies pending migrations on start. A failing migration prevents the API from starting; the error is
  in the first log lines. Do not edit an applied migration file; add a new one with `pnpm db:generate`.

## 7. The API or worker is down

1. Check the process and the last log lines. Both exit on SIGINT/SIGTERM after flushing (delivery events, queue).
2. The API does not need the worker to serve files and accept uploads. While the worker is down, thumbnails, webhook
   delivery, hourly rollups and garbage collection pause and resume on their own when it returns: jobs and the outbox live
   in the database, so nothing is lost.
3. After an outage of more than an hour, run `ops rollup --hours 6` once so the dashboard catches up without waiting.
4. Check `ops stats` for undelivered outbox rows and pending deliveries; they should drain within a minute of the worker
   returning.

## 8. Useful commands

```bash
pnpm --filter @bytedrop/api ops stats               # what is using disk, what is pending
pnpm --filter @bytedrop/api ops gc [--grace-ms N]   # garbage-collect blobs, expire stale uploads, prune old events
pnpm --filter @bytedrop/api ops rollup [--hours N]  # recompute hourly analytics now
pnpm --filter @bytedrop/api ops relay               # push outbox events to deliveries now
curl -s localhost:4000/docs/openapi.json            # the API description
```

## 9. Settings that matter

| Variable | Default | Effect |
|----------|---------|--------|
| `RATE_LIMIT_PER_MIN` | 600 | Requests per minute per API key or session (`429` with `Retry-After`) |
| `DEFAULT_QUOTA_BYTES` | 500 MB | Quota for new projects (`413` when exceeded) |
| `TRANSFORM_CACHE_BYTES` | 256 MB | Disk budget for rendered image variants |
| `HOT_CACHE_BYTES` | 64 MB | Memory budget for small hot files |
| `DELIVERY_META_TTL_MS` | 1000 | How long object metadata is cached for delivery (0 disables) |
| `WEBHOOK_TIMEOUT_MS` | 5000 | Receiver timeout |
| `WEBHOOK_MAX_ATTEMPTS` | 6 | Attempts before a delivery is `failed` |
| `WEBHOOK_BACKOFF_MS` | 5000 | Base of the exponential backoff |
| `WEBHOOK_BREAKER` | on | Per-endpoint circuit breaker |
| `WEBHOOK_CONCURRENCY` | 4 | Deliveries in flight per worker |
| `LOG_LEVEL` | info | pino level |
