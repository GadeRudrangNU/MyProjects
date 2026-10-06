import type { Alert, AskResult, Campaign, Meta, Metrics } from "./types";

interface Snapshot {
  generated_at: string;
  meta: Omit<Meta, "generated_at" | "makes">;
  metrics: Metrics;
  alerts: Alert[];
  campaigns: Campaign[];
}

export interface Data {
  live: boolean; // true when the FastAPI backend answered (enables the Ask tab)
  meta: Meta;
  metrics: Metrics;
  alerts: Alert[];
  campaigns: Campaign[];
  detail(id: number): Promise<Alert>;
  ask(question: string, make?: string, model?: string): Promise<AskResult>;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

/** Prefer the live API; fall back to the bundled snapshot.json (static hosting). */
export async function loadData(): Promise<Data> {
  try {
    const [meta, metrics, alerts, campaigns] = await Promise.all([
      getJson<Meta>("/api/meta"),
      getJson<Metrics>("/api/metrics"),
      getJson<Alert[]>("/api/alerts"),
      getJson<Campaign[]>("/api/campaigns"),
    ]);
    return {
      live: true,
      meta,
      metrics,
      alerts,
      campaigns,
      detail: (id) => getJson<Alert>(`/api/alerts/${id}`),
      ask: async (question, make, model) => {
        const r = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, make: make || null, model: model || null }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`);
        return r.json();
      },
    };
  } catch {
    const snap = await getJson<Snapshot>(`${import.meta.env.BASE_URL}snapshot.json`);
    const byId = new Map(snap.alerts.map((a) => [a.id, a]));
    return {
      live: false,
      meta: { ...snap.meta, generated_at: snap.generated_at, makes: [...new Set(snap.alerts.map((a) => a.make))].sort() },
      metrics: snap.metrics,
      alerts: snap.alerts,
      campaigns: snap.campaigns,
      detail: async (id) => byId.get(id)!,
      ask: async () => {
        throw new Error("Ask needs the live API with Postgres (see README).");
      },
    };
  }
}
