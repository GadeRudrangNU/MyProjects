const encoder = new TextEncoder();

export const BUCKET_COUNT = 10_000;

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

export function murmur3(data: Uint8Array, seed = 0): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h = seed >>> 0;
  const blocks = data.length >>> 2;

  for (let i = 0; i < blocks; i++) {
    const o = i * 4;
    let k = (data[o]! | (data[o + 1]! << 8) | (data[o + 2]! << 16) | (data[o + 3]! << 24)) >>> 0;
    k = Math.imul(k, c1) >>> 0;
    k = rotl(k, 15);
    k = Math.imul(k, c2) >>> 0;
    h = (h ^ k) >>> 0;
    h = rotl(h, 13);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }

  const tail = blocks * 4;
  const remaining = data.length & 3;
  if (remaining > 0) {
    let rest = 0;
    if (remaining === 3) rest ^= data[tail + 2]! << 16;
    if (remaining >= 2) rest ^= data[tail + 1]! << 8;
    rest ^= data[tail]!;
    rest = Math.imul(rest >>> 0, c1) >>> 0;
    rest = rotl(rest, 15);
    rest = Math.imul(rest, c2) >>> 0;
    h = (h ^ rest) >>> 0;
  }

  h = (h ^ data.length) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

export function bucket(flagKey: string, userId: string): number {
  return murmur3(encoder.encode(`${flagKey}:${userId}`)) % BUCKET_COUNT;
}
