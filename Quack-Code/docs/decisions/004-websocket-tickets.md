# 4. Authenticate WebSockets with short-lived signed tickets

**Status:** accepted

## Context
In production the web app and the API live on different sites, so the session cookie is not reliably sent on the WebSocket upgrade, and browsers cannot set headers on a WebSocket.

## Decision
`POST /files/:id/ws-ticket` (cookie-authenticated, requires read access) returns an HMAC-signed ticket valid for 60 seconds and scoped to one user and one file. The upgrade presents it as a query parameter. The ticket carries identity only: the role is looked up again from the database when the socket opens, so a stale ticket cannot grant more than the user currently has.

## Also enforced
- The `Origin` header must match the web app.
- Viewers can sync but their updates are dropped on the server.
- Awareness (presence) is rewritten server-side from the authenticated user, so names cannot be spoofed.
- Removing a member or changing their role closes their live sockets; reconnecting re-checks everything.
