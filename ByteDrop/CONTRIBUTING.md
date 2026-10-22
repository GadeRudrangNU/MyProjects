# Contributing

Thanks for helping. This page covers how work moves from an idea to a merged change. Setting up a machine is in
[docs/development.md](docs/development.md).

## The loop

1. **Start with an issue.** Use the bug or feature template. For anything that changes behaviour, say what the user sees
   before and after. Small fixes can go straight to a pull request.
2. **Branch from `main`.** Name it for the change: `fix/range-416-header`, `feat/webhook-event-filter`.
3. **Make the change small and complete.** Code, tests and docs together. If a decision is worth explaining later, add a
   short record under `docs/adr` (copy `docs/adr/template.md`).
4. **Run the checks locally** (below). They are the same ones CI runs.
5. **Open a pull request** using the template: what changed, why, how it was verified, anything reviewers should look at.
6. **Review.** One approval, green CI. Reviewers ask questions; the author answers in the thread and in code, not in chat,
   so the reasoning stays attached to the change.
7. **Merge by squash.** The squashed message is the change log entry: an imperative sentence, plus a body if the why is not
   obvious. Update `CHANGELOG.md` under "Unreleased" for anything a user or operator would notice.

## Checks

```bash
pnpm typecheck            # every package, strict TypeScript
pnpm test                 # API integration tests, shared and web unit tests
pnpm build                # production builds
pnpm bundle-size          # fails when client JavaScript passes its budget
pnpm e2e                  # browser journeys: the real stack and the demo, with axe
pnpm lhci                 # Lighthouse: performance >= 95 (85 on analytics), accessibility 100
```

A change is not done until the relevant ones pass. Say which you ran in the pull request.

## Conventions

- **TypeScript is strict.** No `any` without a comment that says why. Schemas live in `packages/shared` when both the API
  and the web app use them.
- **Tests describe behaviour.** Name a test after what the user or caller observes ("returns 410 for an expired link"), not
  after a function. Prefer the real database and the real HTTP surface over mocks; the test helpers make that cheap.
- **Comments explain why**, not what. If the code needs a paragraph to be understood, the paragraph belongs in the code or an
  ADR.
- **Migrations are append-only.** Change `src/db/schema.ts`, run `pnpm db:generate`, commit the new SQL file. Never edit one
  that has been applied.
- **Accessibility is a requirement.** New interactive UI needs a label, keyboard operation and a passing axe run in both
  colour schemes. Dialogs go through `components/ui/dialog.tsx`.
- **Performance budgets are real.** Adding a dependency that moves a bundle budget needs a reason in the pull request.
- **Secrets are shown once.** API keys and webhook signing secrets are never logged, stored in plain text or returned by a
  list endpoint.

## Commit messages

Imperative mood, under 72 characters for the subject, no trailing full stop:

```
Return 416 with Content-Range for unsatisfiable ranges
```

Add a body when the reason is not obvious from the diff.

## Reporting a problem in production

Include the request id (`x-request-id` header or `error.requestId` in the body), what you expected, and the time. The
[runbook](RUNBOOK.md) shows what an on-call engineer will look at.
