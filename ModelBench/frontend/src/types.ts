export interface MLModel {
  id: number;
  name: string;
  hf_id: string;
  description: string;
  label_map: Record<string, string>;
  created_at: string;
}

export interface RunMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  n_samples: number;
  latency_ms: { p50: number; p95: number; mean: number };
  throughput_per_s: number;
  confusion_matrix: { labels: string[]; matrix: number[][] };
}

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface Run {
  id: number;
  model_id: number;
  model_name: string;
  dataset: string;
  status: RunStatus;
  metrics: RunMetrics | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface DatasetInfo {
  name: string;
  n_samples: number;
}

export interface Prediction {
  label: string;
  score: number;
  latency_ms: number;
}
