import { hmacHex, safeEqualHex } from "../util";

export function signDownload(secret: string, bucket: string, key: string, exp: number) {
  return hmacHex(secret, `${bucket}\n${key}\n${exp}`);
}

export function buildSignedUrl(
  base: string,
  secret: string,
  bucket: string,
  key: string,
  expiresInSeconds: number,
  now = Date.now(),
) {
  const exp = Math.floor(now / 1000) + expiresInSeconds;
  const sig = signDownload(secret, bucket, key, exp);
  const path = key.split("/").map(encodeURIComponent).join("/");
  return { url: `${base}/f/${bucket}/${path}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export type SignatureCheck = "ok" | "invalid" | "expired";

export function checkSignature(
  secret: string,
  bucket: string,
  key: string,
  exp: string,
  sig: string,
  now = Date.now(),
): SignatureCheck {
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || !safeEqualHex(signDownload(secret, bucket, key, expNum), sig)) return "invalid";
  return expNum * 1000 < now ? "expired" : "ok";
}
