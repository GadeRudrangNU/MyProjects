import { DEMO } from "../config";
import { waitForDemoBackend } from "../demo/ready";
import { createApi, type Requester } from "./endpoints";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function buildUrl(path: string, query?: Record<string, string | number | undefined>) {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export async function parseResponse<T>(res: Response, schema?: { parse(v: unknown): T }): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? `Request failed (${res.status})`, json);
  }
  return (schema ? schema.parse(json) : (json as T)) as T;
}

/** Browser requester: same-origin, cookie session, validated against the shared Zod schemas. */
export const clientRequest: Requester = async (method, path, opts) => {
  if (DEMO) await waitForDemoBackend();
  const res = await fetch(buildUrl(path, opts?.query), {
    method,
    credentials: "same-origin",
    headers: opts?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts?.signal,
  });
  return parseResponse(res, opts?.schema) as never;
};

export const api = createApi(clientRequest);
