import type { Verdict } from "./api";

export const percent = (rate: number, digits = 1) => `${(rate * 100).toFixed(digits)}%`;

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatPValue(p: number): string {
  if (p >= 0.001) return p.toFixed(3);
  if (p === 0) return "0";
  return p.toExponential(1);
}

export const verdictLabel: Record<Verdict, string> = {
  disabled: "Guard off",
  insufficientData: "Collecting data",
  healthy: "Healthy",
  regressed: "Regression detected",
};

export const actionLabel: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  rollback: "Automatic rollback",
  "rollback-proposed": "Rollback proposed",
  "rollback-approved": "Rollback approved",
  "rollback-dismissed": "Rollback dismissed",
};
