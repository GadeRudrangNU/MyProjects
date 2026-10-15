# TrustPass

TrustPass is a member identity and booking platform. People enroll, verify who they are, buy a membership and book time slots. Staff review identity documents and handle support from an admin console. Partner apps can offer "Sign in with TrustPass" and receive a yes/no answer to "is this person a verified adult over 21?" without ever seeing a date of birth.

It is a full-stack Java, React and TypeScript project that runs entirely on a laptop: no Docker, no cloud account and no paid service.

## What it does

**Enrollment and login**
- Sign up with name, email and a password that has to meet a policy. Passwords are hashed with Argon2.
- Email verification by a one-time link that expires after 24 hours. Only a hash of the token is stored.
- Short-lived access tokens, rotating refresh tokens, TOTP two-factor with backup codes, account lockout after five failed attempts, and rate limits per IP address and per email.
- An "Active sessions" page with per-device and "log out everywhere" actions.
- Sign in with GitHub or Google. If the provider's verified email matches an existing account, the user must confirm the link with their password instead of getting a duplicate account.

**Identity verification**
- Upload a government ID (JPEG, PNG or PDF, up to 5 MB). Date of birth and ID number are encrypted in the database and masked in logs.
- A background worker checks that the document is not expired, that the name matches the account, that the person meets the minimum age, and that the same file or ID number is not already used by another account.
- Every verification moves through `PENDING → IN_REVIEW → VERIFIED / REJECTED`. Invalid transitions return `409`. Reviewers approve or reject from a queue and must give a reason when rejecting.

**Membership and billing**
- Basic and Plus plans with subscribe, renew, cancel and billing history.
- A mock payment provider that fails and slows down at random, so the retry and failure handling is exercised for real.

**Booking**
- Admins create locations and time slots with a capacity. Members book, cancel or join a waitlist. When someone cancels, the first eligible person on the waitlist gets the spot and an email.

**Staff console**
- Four roles: member, support, reviewer and admin, enforced on the server for every endpoint.
- An append-only audit log, a dashboard (signups, failed logins, verification pass rate, bookings per location, queue health) and a dead-job screen with a Retry button.

**Sign in with TrustPass**
- TrustPass is itself an OpenID Connect provider. A demo partner app signs users in with Authorization Code and PKCE. The consent screen lists exactly what is shared, and the partner receives only `verified_age_over_21: true | false`.

## How it works

**Sessions.** The API issues a 15-minute JWT access token and a 7-day refresh token in an `httpOnly` cookie. Refresh tokens rotate on every use. If an already-used token is presented again, the family is treated as stolen and every session of that user is revoked. Access tokens carry a session id, so logging out a device takes effect immediately.

**Sensitive data.** Date of birth, ID number and the TOTP secret are encrypted with AES-GCM through a JPA attribute converter. Duplicate-ID detection uses a keyed HMAC fingerprint, so the number itself never needs to be compared in plain text. Uploaded files are validated by their magic bytes, not their extension, and hashed with SHA-256.

**Payments that are safe to retry.** Every payment request carries an `Idempotency-Key`. The key is claimed in PostgreSQL before the provider is called, and the payment, subscription, outbox event and stored response are written in one transaction. A repeated or concurrent duplicate request is answered from the stored result and never charged twice. Provider calls go through Resilience4j with a timeout, retries and a circuit breaker; if the provider is unavailable the key is released so the client can try again.

**Booking without double booking.** A booking locks the slot row with `SELECT … FOR UPDATE`, checks capacity, inserts the booking and increments the counter in one transaction. Slots also carry an `@Version` column as a second line of defence. The tradeoff against optimistic locking: a row lock makes contenders for the same slot queue briefly, which is cheap and needs no retry logic. Optimistic locking avoids the lock but makes every loser retry, and a popular slot is exactly where many requests collide, so the pessimistic approach fits better here.

**Background work.** Events such as "user verified" or "booking confirmed" are written to an outbox table in the same transaction as the change that caused them, so an event is never lost and never sent without its change. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so several copies can run side by side without processing a job twice. Failures back off exponentially. After eight attempts a job becomes `DEAD` and shows up in the admin console. Each job row stores the trace id of the request that created it, which ties an API call to the worker run it caused.

**Sign in with TrustPass.** Spring Authorization Server issues the tokens. The partner is a public client, so PKCE is mandatory. The age claim is computed when a reviewer approves a document and stored as a boolean; the date of birth is never read by the provider.

**Observability.** Actuator and Micrometer expose request rate, p95 latency, error rate, failed logins, queue backlog and dead jobs at `/actuator/prometheus`. Logs are structured JSON tagged with request and user ids. Traces use OpenTelemetry through Micrometer Tracing.

## Architecture

```
React + TypeScript (Vite, :5173)          Partner demo app (:5174)
        │  REST, generated typed client            │  OpenID Connect, Authorization Code + PKCE
        ▼                                          ▼
API service: Spring Boot (:8080)
  auth · users · verification · billing · booking · notifications · audit · admin · authserver
        │
PostgreSQL 16 (embedded, started by the API)
  users, sessions, refresh_tokens, plans, subscriptions, payments, idempotency_keys,
  rate_limit_buckets, locations, slots, bookings, waitlist, verifications, audit_log, outbox_jobs
        │  workers claim jobs with FOR UPDATE SKIP LOCKED
        ▼
Worker service: Spring Boot (:8081), one to three copies
  identity checks · notification emails · retries · dead letters

Uploads → uploads/ through a StorageService interface
Email   → GreenMail, an SMTP server embedded in the worker
```

The API and the worker are two separate Spring Boot services that only coordinate through the database. The API is a modular monolith: each module (auth, users, verification, billing, booking, notifications, audit, admin, authserver) lives in its own package, and Spring Modulith plus ArchUnit tests fail the build if modules form a cycle or reach into each other's internals.

```
trustpass/
  api/            Spring Boot API
  worker/         Spring Boot job runner, identity checks, email
  common/         Shared code: job types, state machine, field encryption, Flyway migrations
  web/            React member app and admin console
  partner-demo/   Vite app that signs in with TrustPass
  loadtest/       k6 scripts
  scripts/        Local start and stop scripts
  docs/           Design decisions
  .github/        CI, CodeQL and Dependabot configuration
```

## Tech stack

| Area | Choices |
| --- | --- |
| Language and framework | Java 21, Spring Boot 3 (Web, Security, Data JPA, Validation, Actuator) |
| Identity | Spring Security, OAuth2 Resource Server, OAuth2 Client, Spring Authorization Server, Argon2 (Bouncy Castle), dev.samstevens.totp for TOTP and QR codes |
| Structure | Spring Modulith, ArchUnit |
| Database | PostgreSQL 16 through Zonky embedded-postgres, Flyway migrations |
| Reliability | Resilience4j (circuit breaker, retry, timeout), Bucket4j rate limits stored in PostgreSQL, Caffeine cache |
| Email | Spring Mail with GreenMail |
| API docs | springdoc-openapi (Swagger UI) |
| Observability | Micrometer and Prometheus format, OpenTelemetry tracing, structured JSON logs |
| Backend tests | JUnit 5, REST Assured, Mockito, embedded PostgreSQL, JaCoCo with an 85% coverage gate |
| Frontend | React 18, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod, Tailwind CSS, shadcn/ui-style components, Recharts |
| API client | orval generates a typed TypeScript client from the backend's OpenAPI document |
| Frontend tests | Vitest, React Testing Library, MSW, Playwright end-to-end tests, axe accessibility checks |
| Build and CI | Maven Wrapper, Jib (container images without Docker), GitHub Actions, CodeQL, Dependabot, Trivy image scans, k6 load tests |

Things that would normally need a server or an account are replaced with local equivalents: embedded PostgreSQL instead of an installed database, PostgreSQL tables and `SKIP LOCKED` instead of a message broker or Redis, the local filesystem behind `StorageService` instead of object storage, and a mock provider instead of a payment service.
