# 0001. One TypeScript monorepo with schemas shared by API and web

Status: Accepted

## Context

The API and the dashboard talk to each other all day: request bodies, query strings, list pages, webhook payloads,
analytics responses. If each side describes those shapes on its own they drift, and the drift is found by a user.

The project also has to run on a laptop with no paid services, so the tooling has to stay light.

## Decision

`pnpm` workspaces with Turborepo. Three packages:

- `packages/shared`: Zod schemas and the small pure helpers both sides need (file kinds, byte formatting, transform URL
  building, latency-histogram percentiles). Built with `tsup` to ESM plus type declarations.
- `apps/api`: Fastify. Routes declare their `params`, `querystring`, `body` and `response` with those schemas through
  `fastify-type-provider-zod`. The OpenAPI document is generated from the same declarations.
- `apps/web`: Next.js. Server and browser requests are validated against the same response schemas before the data
  reaches a component.

TypeScript is `strict` with `noUncheckedIndexedAccess` everywhere.

## Consequences

- Renaming a field is a compile error in both apps, not a runtime surprise.
- The transform URL the playground builds is parsed by the same schema the delivery route uses, and there is a test that
  round-trips one through the other.
- Validating every response in the browser costs a few kilobytes of Zod in the client bundle. The bundle budget
  ([0010](0010-performance-budgets.md)) keeps that honest.
- `packages/shared` must be built before the apps type-check; Turborepo's task graph does this.

## Alternatives considered

- **Generated client from OpenAPI.** Good for third parties and still possible, since the spec is exported, but it adds a
  generation step and a second source of truth for the dashboard.
- **tRPC.** Removes the schema duplication for the dashboard but not for the public REST API, which has to exist anyway
  for API keys, uploads and delivery.
