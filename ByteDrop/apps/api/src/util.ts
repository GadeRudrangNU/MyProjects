import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {},
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

export function newSecret(prefix: string) {
  return `${prefix}${randomBytes(24).toString("base64url")}`;
}

export function hmacHex(secret: string, data: string) {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function likeEscape(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const encodeCursor = (parts: unknown[]) => Buffer.from(JSON.stringify(parts)).toString("base64url");

export function decodeCursor<T extends unknown[]>(cursor: string): T {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (!Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new HttpError(400, "bad_cursor", "Invalid cursor");
  }
}
