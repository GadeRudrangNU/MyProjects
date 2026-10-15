# Configuration

Both services read standard Spring properties, so any value below can be set as an environment variable (`trustpass.db.port` becomes `TRUSTPASS_DB_PORT`).

## API

| Property | Default | Purpose |
| --- | --- | --- |
| `server.port` | `8080` | HTTP port |
| `trustpass.db.embedded` | `true` | Start (or reuse) an embedded PostgreSQL. Set to `false` and provide `spring.datasource.*` for an external database |
| `trustpass.db.port` | `5434` | Port of the embedded PostgreSQL. `0` picks a free port and a temporary data directory (used by tests) |
| `trustpass.db.data-dir` | `.data/pg` | Embedded PostgreSQL data directory |
| `trustpass.security.jwt-secret` | development value | HS256 signing secret for access tokens, at least 32 characters. Change it outside development |
| `trustpass.security.encryption-key` | development value | Key for AES-GCM field encryption. The worker must use the same value |
| `trustpass.security.issuer` | `http://localhost:8080` | Issuer URL of the OpenID provider |
| `trustpass.security.cookie-secure` | `false` | Send the refresh cookie only over HTTPS |
| `trustpass.rate-limit.*` | 30 logins per IP per minute, 10 per email per minute, 20 signups per IP per hour | Request limits. `enabled=false` turns them off |
| `trustpass.payment.*` | 15% declines, 10% outages, 50-600 ms latency, 2.5 s timeout | Behaviour of the mock payment provider |
| `trustpass.frontend-url` | `http://localhost:5173` | Base URL used in emails and OAuth redirects |
| `trustpass.cors.allowed-origins` | web app and partner demo | Origins allowed to call the API |
| `trustpass.partner.redirect-uri` | `http://localhost:5174/callback` | Redirect URI registered for the partner demo client |
| `trustpass.seed.enabled` | `false` | Create demo staff accounts, locations and slots on start |
| `trustpass.seed.load-users` | `false` | Also create members `load1`..`load40@trustpass.dev` with an active plan for load tests |

Sign in with GitHub or Google appears on the login page once the standard Spring client properties are set, for example
`spring.security.oauth2.client.registration.github.client-id` and `...client-secret`, or the equivalents for `google`.
The redirect URI to register with the provider is `{api}/login/oauth2/code/{github|google}`.

## Worker

| Property | Default | Purpose |
| --- | --- | --- |
| `server.port` | `8081` | HTTP port (health, metrics and the development mailbox) |
| `trustpass.db.port` | `5434` | Port of the database started by the API; the worker waits for it |
| `trustpass.mail.embedded` | `true` | Run GreenMail and expose `/dev/mail`. Only one worker copy should do this |
| `trustpass.mail.smtp-port` | `3025` | SMTP port of GreenMail, or of the mail server to send to |
| `trustpass.encryption-key` | development value | Must match the API's `trustpass.security.encryption-key` |
| `trustpass.jobs.batch-size` | `10` | Jobs claimed per poll |

To send real email, set `trustpass.mail.embedded=false` and point `spring.mail.host` and `spring.mail.port` at an SMTP server.
The development mailbox endpoint exists only while the embedded server is on.

## Web app

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:8080` | API base URL |
| `VITE_MAIL_URL` | `http://localhost:8081` | Worker URL for the development mailbox page |
| `WEB_PORT` | `5173` | Dev server port |

The typed API client in `web/src/api/generated` is produced from `web/openapi.json` with `npm run api:generate`.
The OpenAPI document is exported by the `PlatformTest` test when `-Dopenapi.out=<path>` is passed to Maven.
