const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const KEY_STORAGE = "payflow.apiKey";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function getApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? (import.meta.env.VITE_DEMO_API_KEY as string | undefined) ?? "";
  } catch {
    return (import.meta.env.VITE_DEMO_API_KEY as string | undefined) ?? "";
  }
}

export function setApiKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable: the key lives only for this page view */
  }
}

type Options = { method?: string; body?: unknown; idempotencyKey?: string; params?: Record<string, string | number | undefined> };

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function api<T>(path: string, { method = "GET", body, idempotencyKey, params }: Options = {}): Promise<T> {
  const query = params
    ? "?" +
      new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))
    : "";
  const headers: Record<string, string> = { Authorization: `Bearer ${getApiKey()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/v1${path}${query}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error", "Cannot reach the PayFlow API. Is it running?");
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  // 402 (declined) and 202 (held for review) still carry a payment body; callers inspect `status`.
  if (response.ok || ((response.status === 402 || response.status === 202) && data && "status" in data)) {
    return data as T;
  }
  const err = data?.error;
  throw new ApiError(response.status, err?.code ?? "error", err?.message ?? `Request failed (${response.status})`, err?.fields);
}

export async function checkHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health/`);
    return r.ok;
  } catch {
    return false;
  }
}
