# Development guide

Everything runs on one machine with no Docker and no paid services. PostgreSQL comes from the `embedded-postgres` package,
the queue lives inside PostgreSQL, and files are written to a local directory.

## Requirements

- Node.js 20 or newer (developed on 22) and pnpm 12 (`npm i -g pnpm`)
- About 1 GB of free disk for dependencies and the embedded database
- For browser tests: Microsoft Edge or Chrome. Playwright is configured to use the system browser, so no browser download
  is needed. Set `PW_CHANNEL=chrome` to use Chrome; on CI Playwright's bundled Chromium is used.

```bash
pnpm install
pnpm --filter @bytedrop/shared build
```

## Run everything

```bash
pnpm dev
```

This starts, with prefixed logs and one Ctrl+C to stop them all:

| Service | Address | Notes |
|---------|---------|-------|
| PostgreSQL (embedded) | `127.0.0.1:54340` | Data in `.data/pg`; migrations are applied on start |
| Demo data | | Loaded once; skipped if the demo user already exists |
| API | http://localhost:4000 | Interactive docs at `/docs`, metrics at `/metrics` |
| Worker | http://localhost:4001 | `/health`, `/ready`, `/metrics` |
| Webhook receiver | http://127.0.0.1:4010/hook | Verifies signatures. `POST /mode?m=fail`, `hang` or `ok` changes how it behaves |
| Dashboard | http://localhost:3000 | |

Sign in with `demo@bytedrop.dev` / `Demo#2025-pass`. The seed prints two API keys (read and write) when it first runs. The
demo project has three buckets: `acme-assets` (public), `acme-private` (private) and `acme-archive` (12,000 files for the
virtualised list; set `SEED_BULK` before the first run to change the number).

To start fresh, stop everything and delete the `.data` directory.

### Running pieces separately

```bash
pnpm --filter @bytedrop/api db:dev     # PostgreSQL only
pnpm --filter @bytedrop/api seed       # demo data
pnpm --filter @bytedrop/api dev        # API with reload
pnpm --filter @bytedrop/api dev:worker # worker with reload
pnpm --filter @bytedrop/api receiver   # webhook receiver
pnpm --filter @bytedrop/web dev        # dashboard
```

Configuration is by environment variable; every setting has a development default (see `apps/api/src/config.ts`). The ones
you are most likely to change:

| Variable | Default | |
|----------|---------|-|
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:54340/bytedrop` | Point at any PostgreSQL, for example a free Neon database |
| `DATA_DIR` | `<repo>/.data` | Blobs, transform cache and scratch space |
| `AUTH_SECRET`, `URL_SIGNING_SECRET` | development values | Set real values anywhere that is not your laptop |
| `PUBLIC_URL` | `http://localhost:4000` | Origin used in signed links |
| `WEB_ORIGIN` | `http://localhost:3000` | Trusted origin for sign-in |
| `API_URL` (web) | `http://127.0.0.1:4000` | Where the dashboard forwards API calls (read at runtime) |

## Demo mode (no backend)

```bash
pnpm --filter @bytedrop/web build:demo
pnpm --filter @bytedrop/web start:demo      # http://localhost:3200
```

The demo build answers every API call from seeded in-memory data (see ADR 0009). To publish it for free on Vercel, import
the repository, set the root directory to `apps/web`, and use the settings in `apps/web/vercel.json`.

## Tests

```bash
pnpm test                       # everything below, through Turborepo
pnpm --filter @bytedrop/api test
pnpm --filter @bytedrop/web test
pnpm --filter @bytedrop/shared test
```

The API suite starts one embedded PostgreSQL and gives every test file its own database, so files do not interfere. It
needs a couple of minutes on a laptop; most of that is PostgreSQL starting.

### Browser tests

```bash
pnpm --filter @bytedrop/web build:all    # production build and demo build
pnpm e2e                                 # both projects
E2E_SKIP_STACK=1 pnpm --filter @bytedrop/web e2e --project=demo   # demo only, no backend
```

The `live` project starts its own PostgreSQL, API, worker, receiver and web server on separate ports (54360, 4100, 4101,
4110, 3100) with data under `.data-e2e`, seeds it, runs the journeys and tears it all down. Ports must be free; the harness
says so if they are not. Traces and screenshots of failures are in `apps/web/test-results`.

### Performance and size

```bash
pnpm --filter @bytedrop/web build:demo
pnpm bundle-size                         # reads the production build in apps/web/.next
set CHROME_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe   # Windows, if Chrome is not installed
pnpm lhci                                # Lighthouse CI against the demo build
```

`LHCI_PRESET=mobile pnpm lhci` runs the mobile profile; its score is tracked but not gated.

### Load and incident scripts

```bash
pnpm loadtest        # starts a stack, measures delivery and API throughput, writes docs/loadtest-results.json
pnpm incident        # reproduces POSTMORTEM-001 and writes docs/incident-001-data.json
k6 run load/k6-delivery.js -e BASE_URL=http://localhost:4000 -e BUCKET=acme-assets -e KEY=hero/shot-01.png
pnpm gifs            # re-records the README walkthroughs from the real stack
```

## Working on the database

Edit `apps/api/src/db/schema.ts`, then `pnpm db:generate` and commit the new file in `apps/api/drizzle`. Migrations apply when
the API starts. Do not edit migrations that have shipped.

## Layout

```
apps/api        Fastify API, worker, ops scripts, tests
apps/web        Next.js dashboard, demo mode, unit and browser tests
packages/shared Zod schemas and helpers used by both
docs            ADRs, measurements, README media
scripts         dev runner, browser-test stack, load test, GIF recorder
load            k6 script
```

## Troubleshooting

- **A port is in use.** Another copy of the stack is probably running. On Windows,
  `Get-NetTCPConnection -LocalPort 4000 -State Listen` shows the owner.
- **PostgreSQL will not start after a crash.** Delete `.data/pg/postmaster.pid` (it is stale if no `postgres` process is
  running) and try again.
- **Browser tests cannot find a browser.** Install Edge or Chrome, or set `PW_CHANNEL` to `chrome`, or run
  `pnpm exec playwright install chromium` and set `PW_CHANNEL=` to an empty string.
