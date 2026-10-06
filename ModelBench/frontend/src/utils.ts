import type { Run } from "./types";

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export const isActive = (r: Run) => r.status === "queued" || r.status === "running";

export const runLabel = (r: Run) => `#${r.id} ${r.model_name}`;

/** One row per metric, one column per run: the shape recharts' grouped bars want. */
export function qualityChartData(runs: Run[]) {
  const done = runs.filter((r) => r.metrics);
  return (["accuracy", "precision", "recall", "f1"] as const).map((metric) => ({
    metric: metric === "f1" ? "F1" : metric[0].toUpperCase() + metric.slice(1),
    ...Object.fromEntries(done.map((r) => [runLabel(r), +((r.metrics![metric] as number) * 100).toFixed(1)])),
  }));
}

export function latencyChartData(runs: Run[]) {
  return runs
    .filter((r) => r.metrics)
    .map((r) => ({ run: runLabel(r), p50: r.metrics!.latency_ms.p50, p95: r.metrics!.latency_ms.p95 }));
}
