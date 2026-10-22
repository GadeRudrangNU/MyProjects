# 0002. PostgreSQL is the only stateful service

Status: Accepted

## Context

ByteDrop needs a relational store, a job queue, sessions and somewhere to write analytics events. The constraint is that
it must run for free on one machine without Docker, and that production support should have as few moving parts to
watch as possible.

## Decision

PostgreSQL does all of it:

- **Data and migrations:** Drizzle ORM and `drizzle-kit` generated SQL migrations checked into `apps/api/drizzle`.
- **Jobs:** `pg-boss` stores its queues in the same database and claims work with `FOR UPDATE SKIP LOCKED`, so several
  workers never take the same job.
- **Sessions and accounts:** Better Auth with its Drizzle adapter, in the same schema.
- **Analytics events and rollups:** ordinary tables.
- **Outbox:** a table, written in the same transaction as the change it announces ([0006](0006-transactional-outbox-webhooks.md)).
- **Local development and tests:** the `embedded-postgres` npm package downloads PostgreSQL binaries per platform, so
  nothing is installed and no container is needed. Production can point `DATABASE_URL` at any PostgreSQL, including a free
  hosted one.

Files themselves live behind a `StorageDriver` interface. The shipped driver writes to the local filesystem; an S3 driver
would implement the same five methods.

## Consequences

- One backup, one connection string, one thing to check in `/ready`.
- A job can be enqueued inside the transaction that needs it (the outbox relay does this), which a separate broker cannot
  offer.
- Rate limiting is in process memory (a token bucket per key). That is correct for a single API instance and approximate
  across several. Moving it to PostgreSQL would cost a write per request, so it is left until a second instance exists.
- Heavy queue throughput would eventually want a dedicated broker. At the scale this project targets that is not a concern,
  and `pg-boss` has a documented path to other backends.

## Alternatives considered

- **Redis for queue and rate limits.** Faster, but a second service to run, secure and monitor, and it breaks the
  "runs anywhere with `pnpm dev`" goal.
- **SQLite.** Simplest to embed, but the queue and outbox patterns here rely on row locking and concurrent writers.
