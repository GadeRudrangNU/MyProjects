# Design decisions

## Two services that share only the database

The API handles requests; the worker handles everything that can happen later (identity checks, email, retries). They never call each other. The API writes an `outbox_jobs` row in the same transaction as the business change, and workers pick rows up. This keeps request latency independent of email or document processing and lets the worker be scaled or restarted on its own.

## Pessimistic locking for bookings

`BookingService` loads the slot with `PESSIMISTIC_WRITE` (`SELECT … FOR UPDATE`) before checking capacity. Concurrent requests for the same slot queue on that row; requests for different slots do not interact. The `@Version` column on `Slot` stays as a safety net for any code path that forgets the lock. A test books a capacity-3 slot from twelve threads and asserts exactly three bookings.

Optimistic locking was the alternative. It avoids holding a lock but turns every collision into a failed request that has to be retried, and a popular slot is the case where collisions are most likely.

## Idempotency keys claimed before the provider call

The key row is inserted (`ON CONFLICT DO NOTHING`) in its own transaction before the payment provider is called. A second request with the same key either replays the stored response, is rejected with `409` while the first is still running, or is rejected with `422` if the body differs. After the provider answers, the payment, subscription, outbox event and stored response are committed together. If the provider is unavailable nothing was charged, so the key row is deleted and the client may retry with the same key.

## Refresh token families

Each login creates a session. Every refresh marks the presented token used and issues a new one. Presenting a used token revokes all sessions of that user and writes an audit entry. Access tokens contain the session id and are checked against the sessions table, so revoking a session takes effect on the next request instead of after the 15-minute expiry.

## Account linking needs the password

An OAuth sign-in whose verified email matches an existing account does not log the user in and does not create a second account. The user is sent to a confirmation page and must enter their TrustPass password to attach the provider. Unverified provider emails are refused.

## The age claim is a stored boolean

When a reviewer approves a document, the API computes whether the person is at least 21 and stores `age_over_21`. The OpenID provider reads that boolean. It has no code path that decrypts a date of birth.

## Embedded PostgreSQL

The API starts PostgreSQL through Zonky's embedded binaries on port 5434 with a data directory under `.data/pg`. If a server is already listening on that port, the API reuses it, which is how the worker and the API share one database. The worker waits for the port to come up.

## Local replacements

| Normally | Here |
| --- | --- |
| Managed email service | GreenMail embedded in the worker, readable at `/dev/mail` |
| Message broker | `outbox_jobs` with `FOR UPDATE SKIP LOCKED` |
| Redis rate limiter | Bucket4j buckets in PostgreSQL |
| Object storage | `StorageService` backed by `uploads/` |
| Payment service | A mock provider with configurable decline, outage and latency rates |
| Identity provider SaaS | Spring Authorization Server inside the API |
