import type { MLModel, Run } from "./types";

export const model = (id: number, name: string): MLModel => ({
  id, name, hf_id: `org/${name}`, description: `${name} desc`, label_map: {}, created_at: "2025-01-01T00:00:00Z",
});

export const run = (id: number, name: string, f1: number, p95: number, status: Run["status"] = "completed"): Run => ({
  id, model_id: id, model_name: name, dataset: "sample_sentiment", status, error: null,
  created_at: "2025-01-01T00:00:00Z", finished_at: null,
  metrics: status === "completed"
    ? {
        accuracy: f1, precision: f1, recall: f1, f1, n_samples: 60,
        latency_ms: { p50: p95 / 2, p95, mean: p95 / 2 }, throughput_per_s: 40,
        confusion_matrix: { labels: ["negative", "positive"], matrix: [[1, 0], [0, 1]] },
      }
    : null,
});
