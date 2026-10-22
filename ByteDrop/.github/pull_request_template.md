## What changed

<!-- One or two sentences. Link the issue: "Fixes #123". -->

## Why

<!-- The problem this solves, or the decision behind the approach. Add an ADR under docs/adr if it is a lasting one. -->

## How it was verified

<!-- Tick what you ran, and add anything specific you checked by hand. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build` and `pnpm bundle-size`
- [ ] `pnpm e2e` (needed for anything that touches the UI or the upload, delivery or webhook paths)
- [ ] `pnpm lhci` (needed when a page gets heavier)

## Notes for reviewers

<!-- Where to look first, trade-offs, anything you are unsure about. -->

## Checklist

- [ ] Behaviour changes have tests that name the behaviour
- [ ] New UI is labelled, keyboard operable and passes axe in light and dark
- [ ] `CHANGELOG.md` updated if a user or operator would notice
- [ ] `RUNBOOK.md` updated if this changes how the service fails or is diagnosed
