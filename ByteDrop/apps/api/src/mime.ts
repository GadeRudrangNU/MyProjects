import path from "node:path";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".zip": "application/zip",
};

export function guessContentType(key: string, declared?: string): string {
  if (declared && declared !== "application/octet-stream") return declared;
  return TYPES[path.extname(key).toLowerCase()] ?? declared ?? "application/octet-stream";
}

export function validateKey(key: string): string | null {
  if (!key || key.length > 512) return "Key must be 1-512 characters";
  if (key.startsWith("/") || key.split("/").includes("..")) return "Key must not start with / or contain ..";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(key)) return "Key must not contain control characters";
  return null;
}
