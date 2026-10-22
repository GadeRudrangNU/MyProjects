# 0010. Performance and bundle budgets are enforced in CI

Status: Accepted

## Context

Front-end speed erodes one dependency at a time. A number that nobody checks is a number that gets worse.

## Decision

- **Lighthouse CI** audits five pages of the demo build (sign in, projects, files, webhooks, analytics) with three runs each
  and the desktop profile. The build fails if the median performance score is below 95 or the accessibility score is below
  100. The analytics page ships a charting library of roughly 200 KB gzip and has a lower performance floor (85); its
  accessibility requirement is unchanged. Best practices and SEO warn but do not fail. Audits use the demo build so they
  measure the front end, not the speed of a backend.
- **Bundle budgets** (`pnpm bundle-size`), gzip: shared baseline loaded on every page 150 KB, largest single chunk 130 KB,
  all client JavaScript 650 KB. The script reads the Next.js build output.
- **Accessibility** is also checked with axe in Playwright on every page and every dialog, in light and dark colour schemes,
  with a keyboard-only journey for the file list and the upload queue.
- Techniques that earned the scores: server components for everything that does not need the browser, the charting library
  loaded on demand with a skeleton of the final size so nothing shifts, the demo service worker started only when needed,
  a native `<select>` instead of a heavy component, and CSS variables for both colour schemes.

## Consequences

- A pull request that adds a heavy dependency fails with a table that says which budget moved.
- Mobile emulation with Lighthouse's default throttling scores lower (around 80 on this codebase) because the framework
  baseline dominates at 4× CPU slowdown. That number is tracked, not gated, and the responsive layout is verified separately.

## Alternatives considered

- **Budgets only in documentation.** They would be ignored by the second month.
- **A single threshold for every page.** Hides the fact that one page carries a library the others do not.
