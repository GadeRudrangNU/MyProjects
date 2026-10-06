export interface Summary {
  text: string;
  mode: "ollama" | "extractive";
  grounded: boolean;
  issues: string[];
}
export interface Evidence {
  id: number;
  date: string;
  year: number;
  severe: boolean;
  text: string;
}
export interface CampaignRef {
  camp_no: string;
  report_date: string;
  component: string;
  years: number[];
  description: string;
  potentially_affected: number;
}
export type Outcome = "hit" | "miss" | "pending" | "already_recalled";
export interface Alert {
  id: number;
  make: string;
  model: string;
  component: string;
  years: number[];
  alert_date: string;
  first_date: string;
  n_window: number;
  severe_window: number;
  score: number;
  cluster_size: number;
  merged_count: number;
  keywords: string[];
  summary: Summary;
  evidence?: Evidence[];
  timeline?: { month: string; count: number }[];
  outcome: Outcome;
  campaign: CampaignRef | null;
  lead_weeks: number | null;
}
export interface Campaign extends CampaignRef {
  make: string;
  model: string;
  status: "early" | "late" | "missed";
  addressable: boolean;
  n_complaints_before: number;
  lead_weeks: number | null;
  alert_id: number | null;
  alert_date: string | null;
}
export interface SweepRow {
  min_count: number;
  alerts_total: number;
  precision_pct: number | null;
  recall_pct_all: number | null;
  recall_pct_addressable: number | null;
  lead_weeks_mean: number | null;
}
export interface Metrics {
  campaigns_total: number;
  campaigns_addressable: number;
  detected_early: number;
  detected_early_addressable: number;
  detected_late: number;
  missed: number;
  recall_pct_all: number | null;
  recall_pct_addressable: number | null;
  lead_weeks_mean: number | null;
  lead_weeks_median: number | null;
  alerts_total: number;
  alerts_hit: number;
  alerts_miss: number;
  alerts_already_recalled: number;
  alerts_pending: number;
  precision_pct: number | null;
  lead_histogram: { bin: string; count: number }[];
  sweep: SweepRow[];
  summaries: {
    total: number;
    llm_summaries: number;
    hallucination_rate_pct: number | null;
    final_grounded_pct: number | null;
  };
  config: Record<string, number>;
}
export interface Meta {
  mode: "synthetic" | "nhtsa";
  embedder: string;
  note?: string;
  complaints: number;
  date_range: [string, string];
  generated_at: string;
  makes: string[];
}
export interface Source {
  id: number;
  date: string;
  year: number;
  make: string;
  model: string;
  similarity: number;
  text: string;
}
export interface AskResult {
  answer: string;
  mode: string;
  grounded: boolean;
  sources: Source[];
}
