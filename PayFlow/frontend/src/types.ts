export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export type PaymentStatus = "pending" | "authorized" | "captured" | "refunded" | "failed";
export type FraudDecision = "approve" | "review" | "block" | "";

export type FraudReason = { code: string; risk: number; detail: string };

export type Payment = {
  id: string;
  status: PaymentStatus;
  amount: number;
  refunded_amount: number;
  currency: string;
  payer_id: string;
  payee_id: string;
  description: string;
  device_id: string;
  auto_capture: boolean;
  failure_reason: string;
  fraud_score: number | null;
  fraud_decision: FraudDecision;
  fraud: {
    score: number;
    decision: FraudDecision;
    model_score: number | null;
    amount_zscore: number | null;
    reasons: FraudReason[];
  } | null;
  created_at: string;
  captured_at: string | null;
};

export type AccountKind = "customer" | "merchant" | "external" | "holds";

export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  balance: number;
  created_at: string;
};

export type LedgerEntry = { id: number; account_id: string; amount: number; created_at: string };
export type LedgerTransaction = {
  id: string;
  kind: string;
  reference: string;
  memo: string;
  created_at: string;
  entries: LedgerEntry[];
};

export type ReviewItem = {
  id: number;
  status: "open" | "approved" | "rejected";
  note: string;
  created_at: string;
  resolved_at: string | null;
  payment: Payment;
};

export type WebhookDelivery = {
  id: string;
  event_type: string;
  status: "pending" | "delivered" | "dead";
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_error: string;
  created_at: string;
  delivered_at: string | null;
  payload: unknown;
};

export type ReconciliationRun = {
  id: string;
  status: "ok" | "mismatch";
  accounts_checked: number;
  transactions_checked: number;
  mismatch_count: number;
  findings: Record<string, unknown>[];
  started_at: string;
  finished_at: string;
};

export type Settlement = { id: string; account_id: string; amount: number; payment_count: number; created_at: string };

export type Overview = {
  payments: {
    total: number;
    by_status: Partial<Record<PaymentStatus, number>>;
    success_rate: number | null;
    flagged: number;
    flag_rate: number | null;
    captured_volume: number;
    refunded_volume: number;
  };
  accounts: number;
  open_reviews: number;
  webhooks: Partial<Record<"pending" | "delivered" | "dead", number>>;
  reconciliation: { status: "ok" | "mismatch"; mismatch_count: number; finished_at: string } | null;
  series: { minute: string; count: number; volume: number; flagged: number }[];
};

export type ConfusionStats = {
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  false_positive_rate: number;
};

export type ModelInfo =
  | { loaded: false }
  | {
      loaded: true;
      review_threshold: number;
      block_threshold: number;
      metrics: {
        pr_auc: number;
        roc_auc: number;
        review_or_block: ConfusionStats;
        block: ConfusionStats;
        test_rows: number;
        test_frauds: number;
      };
    };

export type WebhookEndpoint = { url: string; secret: string; signature_header: string };
