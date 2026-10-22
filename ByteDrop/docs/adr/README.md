# Architecture decision records

Short notes on the decisions that shaped ByteDrop: what the problem was, what was chosen, what was given up. They are
numbered in the order they were made. A record is never rewritten after the fact; if a decision changes, a new record
says so and the old one is marked as superseded.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-monorepo-and-shared-schemas.md) | One TypeScript monorepo with schemas shared by API and web | Accepted |
| [0002](0002-postgres-as-the-only-service.md) | PostgreSQL is the only stateful service (data, queue, auth) | Accepted |
| [0003](0003-content-addressed-storage.md) | Content-addressed blobs with reference counts and delayed garbage collection | Accepted |
| [0004](0004-resumable-upload-protocol.md) | Resumable uploads: server-owned offset, per-chunk and whole-file hashes | Accepted |
| [0005](0005-delivery-semantics.md) | Delivery behaves like a CDN origin: ETag, ranges, signed links, transform cache | Accepted |
| [0006](0006-transactional-outbox-webhooks.md) | Webhooks through a transactional outbox, with retries, a log and a circuit breaker | Accepted |
| [0007](0007-analytics-rollups.md) | Analytics: buffered raw events, idempotent hourly rollups, histogram percentiles | Accepted |
| [0008](0008-observability.md) | Logs, metrics and traces: what is recorded and why | Accepted |
| [0009](0009-same-origin-proxy-and-demo-mode.md) | The browser talks to one origin; demo mode runs the whole UI without a backend | Accepted |
| [0010](0010-performance-budgets.md) | Performance and bundle budgets are enforced in CI | Accepted |

New records start from [template.md](template.md).
