# Changelog

All notable changes are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/) and
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

First complete version: backend, dashboard, documentation and the checks that keep them honest.

### Added

**Storage and delivery**
- Projects, buckets (public or private, globally unique names) and files, with cursor pagination on every list.
- Content-addressed storage: files are stored once by SHA-256 with reference counts; a garbage collector with a grace period
  and row locking removes unreferenced content.
- Resumable uploads: sessions with a server-owned offset, per-chunk and whole-file hash verification, instant completion for
  content that already exists.
- Delivery with `ETag`/`If-None-Match` (304), `Range` (206/416), `Cache-Control`, `Content-Type`, `Content-Disposition`.
- Signed, expiring links for private buckets (403 for a bad signature, 410 for an expired one).
- On-the-fly image transforms with `sharp`, a disk LRU cache, request coalescing and a four-render concurrency limit.
- Small-file memory cache and one-second metadata cache with request collapsing on the delivery path.

**Accounts and limits**
- Dashboard sign-in with Better Auth (email and password); per-project API keys stored hashed, scoped read or write, revocable.
- Per-key token-bucket rate limiting (`429` with `Retry-After`) and per-project storage quotas (`413`).

**Webhooks and background work**
- Transactional outbox, signed (HMAC-SHA256) deliveries, exponential backoff with jitter, delivery log, replay, per-endpoint
  circuit breaker.
- pg-boss worker process: thumbnails, garbage collection, analytics rollups, webhook delivery.

**Analytics**
- Buffered delivery events, idempotent hourly rollups with latency histograms, analytics API (requests, bandwidth, cache hit
  rate, p95, top files, top referrers) with bucket, file type and date filters.

**Operations**
- pino JSON logs with request ids, `/health`, `/ready`, Prometheus metrics on API and worker, OpenTelemetry traces that follow
  a request into queue jobs and webhook deliveries, OpenAPI 3 document and interactive docs at `/docs`.
- `RUNBOOK.md`, `POSTMORTEM-001.md`, ADRs, an `ops` command-line tool, and a reproducible incident script.

**Dashboard**
- Next.js App Router: server-rendered analytics and lists, filters kept in the URL.
- Virtualised file browser (tested with 12,000 files) with search, sort, multi-select and full keyboard control.
- Upload queue with drag-and-drop, pause, resume, retry, cancel; hashing in a Web Worker; persistence in IndexedDB so uploads
  continue after a refresh.
- File preview (image, video, audio, PDF, text), share-link generator with expiry picker and copy button.
- Image transform playground with before and after sizes.
- Recharts dashboards for requests, bandwidth, cache hit rate and p95 latency, with skeleton, empty and error states.
- Webhook endpoints and delivery log with replay; API keys with one-time secrets.
- Responsive down to phone width, light and dark colour schemes.
- Demo mode: the whole interface on seeded in-memory data via Mock Service Worker, deployable to a free static-style host.

**Quality gates**
- API: 96 integration tests against embedded PostgreSQL (delivery, uploads, storage, auth, webhooks, analytics, observability).
- Web: 40 unit and component tests (upload manager, keyboard model, dialogs, API client), 10 shared-package tests, and 22
  Playwright journeys on the real stack and on the demo, with axe checks on every page and dialog in both colour schemes.
- Lighthouse CI (performance and accessibility gates), bundle-size budgets, a k6 script and a local load test.
- GitHub Actions workflow, issue and pull request templates.

### Fixed during development

- Cursor pagination on timestamps skipped or repeated rows when PostgreSQL's microseconds were truncated to milliseconds in
  the cursor; timestamps are now stored at millisecond precision.
- Scheduled jobs carry no payload and crashed the handler wrapper; payloads are now optional there.
- Switching buckets left the previous bucket's search text in the box, and clearing it could send the address bar back to
  the previous bucket because URL changes were built from a stale snapshot.
- Keyboard `Home`/`End` did not scroll a virtualised list to the target row.
