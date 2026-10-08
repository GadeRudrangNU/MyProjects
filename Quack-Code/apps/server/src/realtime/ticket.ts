import { createHmac, timingSafeEqual } from 'node:crypto';

interface Payload {
  u: string; // user id
  f: string; // file id
  e: number; // expiry, ms epoch
}

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

/**
 * Short-lived, file-scoped proof of identity for the WebSocket upgrade. The browser cannot rely on the
 * session cookie there (the API and the web app live on different sites in production). It carries no
 * role: permissions are looked up again when the socket opens.
 */
export function issueTicket(secret: string, userId: string, fileId: string, ttlMs = 60_000): string {
  const body = Buffer.from(JSON.stringify({ u: userId, f: fileId, e: Date.now() + ttlMs } satisfies Payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyTicket(secret: string, ticket: string, fileId: string): string | null {
  const [body, sig] = ticket.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload;
    return p.f === fileId && p.e > Date.now() ? p.u : null;
  } catch {
    return null;
  }
}
