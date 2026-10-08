# 3. PostgreSQL holds app data and document state

**Status:** accepted (job queue part still to be built)

## Decision
One PostgreSQL database stores users, workspaces, files, and each file's Yjs state (`bytea`) together with its plain text and a generated `tsvector` for future search. Background jobs are planned on `pg-boss`, which also uses Postgres.

## Why
A single free Neon database keeps the system small and the cost at zero, and avoids running Redis just for a queue. Document state in Postgres means the server holds nothing essential in memory.

## Local development
Docker is not required. `embedded-postgres` runs real PostgreSQL binaries (same engine as production) for development, API tests and end-to-end tests. CI uses a Postgres service container instead.
