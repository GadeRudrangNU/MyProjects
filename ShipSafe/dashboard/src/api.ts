export type Operator = "in" | "notIn";

export interface Condition {
  attribute: string;
  operator: Operator;
  values: string[];
}

export interface Guard {
  enabled: boolean;
  mode: "auto" | "approval";
  minSamples: number;
  alpha: number;
  minDifference: number;
  windowSeconds: number;
}

export interface Flag {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  conditions: Condition[];
  guard: Guard;
  version: number;
  updatedAt: string;
}

export type FlagInput = Omit<Flag, "version" | "updatedAt">;

export interface Arm {
  requests: number;
  errors: number;
  rate: number;
}

export type Verdict = "disabled" | "insufficientData" | "healthy" | "regressed";

export interface Assessment {
  verdict: Verdict;
  treatment: Arm;
  control: Arm;
  z: number;
  pValue: number;
  difference: number;
}

export interface SeriesPoint {
  second: number;
  treatmentRequests: number;
  treatmentErrors: number;
  controlRequests: number;
  controlErrors: number;
}

export interface FlagMetrics {
  assessment: Assessment;
  windowSeconds: number;
  series: SeriesPoint[];
}

export interface Proposal {
  id: number;
  flagKey: string;
  createdAt: string;
  status: "pending" | "approved" | "dismissed";
  evidence: Assessment | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  flagKey: string;
  summary: string;
  evidence: Assessment | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

const adminKey = import.meta.env.VITE_ADMIN_KEY ?? "dev-admin-key";
const actorStorageKey = "shipsafe.actor";

export function getActor(): string {
  try {
    return localStorage.getItem(actorStorageKey) || "admin";
  } catch {
    return "admin";
  }
}

export function setActor(name: string): void {
  try {
    localStorage.setItem(actorStorageKey, name);
  } catch {
    return;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-admin-key": adminKey,
      "x-actor": getActor(),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let fields: Record<string, string[]> = {};
    try {
      const body = await response.json();
      message = body.error ?? body.title ?? message;
      fields = body.errors ?? {};
    } catch {
      fields = {};
    }
    throw new ApiError(message, response.status, fields);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  flags: () => request<Flag[]>("/flags"),
  createFlag: (input: FlagInput) => request<Flag>("/flags", { method: "POST", body: json(input) }),
  updateFlag: (input: FlagInput) =>
    request<Flag>(`/flags/${encodeURIComponent(input.key)}`, { method: "PUT", body: json(input) }),
  deleteFlag: (key: string) => request<void>(`/flags/${encodeURIComponent(key)}`, { method: "DELETE" }),
  metrics: (key: string) => request<FlagMetrics>(`/flags/${encodeURIComponent(key)}/metrics?seconds=120`),
  audit: (flagKey?: string) =>
    request<AuditRow[]>(`/audit?limit=100${flagKey ? `&flagKey=${encodeURIComponent(flagKey)}` : ""}`),
  proposals: (status = "pending") => request<Proposal[]>(`/proposals?status=${status}`),
  approve: (id: number) => request<Proposal>(`/proposals/${id}/approve`, { method: "POST" }),
  dismiss: (id: number) => request<Proposal>(`/proposals/${id}/dismiss`, { method: "POST" }),
};

export function toInput(flag: Flag): FlagInput {
  const { version: _version, updatedAt: _updatedAt, ...input } = flag;
  return input;
}
