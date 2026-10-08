import { describe, expect, it } from 'vitest';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { sanitizeAwareness } from '../src/realtime/awareness.js';

const conn = { userId: 'real-id', userName: 'Real Name' };

function encode(states: Array<[number, unknown]>) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, states.length);
  for (const [id, state] of states) {
    encoding.writeVarUint(enc, id);
    encoding.writeVarUint(enc, 1);
    encoding.writeVarString(enc, JSON.stringify(state));
  }
  return encoding.toUint8Array(enc);
}

function decode(update: Uint8Array) {
  const dec = decoding.createDecoder(update);
  const n = decoding.readVarUint(dec);
  return Array.from({ length: n }, () => {
    decoding.readVarUint(dec);
    decoding.readVarUint(dec);
    return JSON.parse(decoding.readVarString(dec)) as { user: { id: string; name: string; color: string }; cursor?: unknown } | null;
  });
}

describe('sanitizeAwareness', () => {
  it('overwrites a spoofed identity with the authenticated one', () => {
    const out = sanitizeAwareness(encode([[1, { user: { id: 'victim', name: 'Admin', color: '#ff0000' }, cursor: { anchor: 1 } }]]), conn)!;
    expect(decode(out)[0]).toEqual({ user: { id: 'real-id', name: 'Real Name', color: '#ff0000' }, cursor: { anchor: 1 } });
  });
  it('rejects non-hex colours (no CSS injection) and drops unknown fields', () => {
    const out = sanitizeAwareness(encode([[1, { user: { color: 'red; background:url(x)' }, evil: '<img>' }]]), conn)!;
    expect(decode(out)[0]).toEqual({ user: { id: 'real-id', name: 'Real Name', color: '#cccccc' } });
  });
  it('passes removals (null state) through', () => {
    expect(decode(sanitizeAwareness(encode([[1, null]]), conn)!)[0]).toBeNull();
  });
  it('rejects malformed input and too many client ids', () => {
    expect(sanitizeAwareness(new Uint8Array([9, 9, 9]), conn)).toBeNull();
    expect(sanitizeAwareness(encode([[1, 'str']]), conn)).toBeNull();
    expect(sanitizeAwareness(encode(Array.from({ length: 5 }, (_, i) => [i, {}] as [number, unknown])), conn)).toBeNull();
  });
});
