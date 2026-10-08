export interface Cursor {
  t: string;
  id: string;
}

export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Cursor;
    return typeof c.t === 'string' && typeof c.id === 'string' ? c : null;
  } catch {
    return null;
  }
}
