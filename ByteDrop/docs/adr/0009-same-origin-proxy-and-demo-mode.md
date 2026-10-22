# 0009. The browser talks to one origin; demo mode runs the whole UI without a backend

Status: Accepted

## Context

Two requirements pull on the front end. Sessions should be first-party cookies, with no cross-site configuration. And a live
demo must be hostable on a free static-style host with no backend, with real-looking data.

## Decision

**Same origin.** The Next.js app has a `proxy.ts` that forwards `/v1/*`, `/api/auth/*` and `/f/*` to the API at runtime
(`API_URL`). The browser never sees another origin, so cookies are plain `SameSite=Lax` first-party cookies and there is no
CORS to configure. Server components call the API directly and forward the visitor's cookie.

**Server first, then the browser.** Lists and dashboards are rendered by server components from URL search parameters, so a
link reproduces the view. File lists, webhook logs and key lists then manage their own data on the client (TanStack Query for
mutations, a local refetch afterwards) so that filtering and uploads do not re-render the whole route.

**Demo mode** (`NEXT_PUBLIC_DEMO=1`). One in-memory implementation of the API (`lib/demo/router.ts`) is used in two places:
server components call it directly, and in the browser a Mock Service Worker answers `fetch` with the same function. Seed data
is deterministic (a project with three buckets, 12,000 archived files, a delivery log with failures, two weeks of analytics).
The service worker starts only when something needs it, so first paint stays light. Creating projects is disabled in the demo;
uploads, deletes, keys, webhooks, replays and share links work and live in the tab.

## Consequences

- The demo deploys to the free Vercel hobby plan with no environment variables other than the flag.
- The same unit tests that cover the upload manager run against the demo router through `msw/node`.
- The demo router is a second implementation of the API surface the UI uses; the typed endpoint catalogue and the shared
  response schemas keep it honest, and the browser tests run the same journeys against both.

## Alternatives considered

- **Direct cross-origin calls with CORS and `SameSite=None`.** Works, but needs HTTPS in development and breaks in browsers
  that block third-party cookies.
- **A hosted demo API.** Not free to keep alive, and a shared mutable database is a bad demo.
