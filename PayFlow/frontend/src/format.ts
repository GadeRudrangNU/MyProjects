const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Amounts travel as integer cents; format them as dollars. */
export function money(cents: number, signed = false): string {
  const text = usd.format(Math.abs(cents) / 100);
  if (cents < 0) return `-${text}`;
  return signed && cents > 0 ? `+${text}` : text;
}

export function compactMoney(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`;
  if (Math.abs(dollars) >= 10_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return usd.format(dollars);
}

export function percent(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(digits)}%`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const FAILURE_LABELS: Record<string, string> = {
  insufficient_funds: "Insufficient funds",
  fraud_blocked: "Blocked by fraud model",
  fraud_rejected: "Rejected by analyst",
  voided: "Voided by merchant",
};

export function failureLabel(reason: string): string {
  return FAILURE_LABELS[reason] ?? reason.replace(/_/g, " ");
}
