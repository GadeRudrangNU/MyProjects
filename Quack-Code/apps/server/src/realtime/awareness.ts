import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { Connection } from './docs.js';

const MAX_CLIENT_IDS_PER_SOCKET = 4;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Presence is client-supplied, so identity is not trusted: the user field is rewritten from the
 * authenticated session before the update reaches anyone else. Returns null for malformed updates.
 */
export function sanitizeAwareness(update: Uint8Array, conn: Pick<Connection, 'userId' | 'userName'>): Uint8Array | null {
  try {
    const dec = decoding.createDecoder(update);
    const count = decoding.readVarUint(dec);
    if (count > MAX_CLIENT_IDS_PER_SOCKET) return null;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, count);
    for (let i = 0; i < count; i++) {
      const clientId = decoding.readVarUint(dec);
      const clock = decoding.readVarUint(dec);
      const raw = JSON.parse(decoding.readVarString(dec)) as unknown;
      let state: Record<string, unknown> | null = null;
      if (raw !== null) {
        if (typeof raw !== 'object' || Array.isArray(raw)) return null;
        const r = raw as { user?: { color?: unknown }; cursor?: unknown };
        const color = typeof r.user?.color === 'string' && HEX_COLOR.test(r.user.color) ? r.user.color : '#cccccc';
        state = { user: { id: conn.userId, name: conn.userName, color } };
        if (r.cursor && typeof r.cursor === 'object') state.cursor = r.cursor;
      }
      encoding.writeVarUint(enc, clientId);
      encoding.writeVarUint(enc, clock);
      encoding.writeVarString(enc, JSON.stringify(state));
    }
    return encoding.toUint8Array(enc);
  } catch {
    return null;
  }
}
