export const RANGES = [
  { value: "24h", label: "Last 24 hours", ms: 24 * 3_600_000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { value: "14d", label: "Last 14 days", ms: 14 * 86_400_000 },
  { value: "30d", label: "Last 30 days", ms: 30 * 86_400_000 },
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface RangeInput {
  range?: string;
  from?: string;
  to?: string;
}

/** Turns URL parameters into the ISO window the API expects. A custom from/to wins over a preset. */
export function resolveRange(input: RangeInput, now = Date.now()): { from: string; to: string; label: string; preset: string } {
  if (input.from && DATE_RE.test(input.from)) {
    const from = new Date(`${input.from}T00:00:00.000Z`).getTime();
    const toDay = input.to && DATE_RE.test(input.to) ? new Date(`${input.to}T23:59:59.999Z`).getTime() : now;
    const to = Math.min(toDay, now);
    if (from < to && to - from <= 90 * 86_400_000) {
      return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), label: `${input.from} to ${input.to ?? "today"}`, preset: "custom" };
    }
  }
  const preset = RANGES.find((r) => r.value === input.range) ?? RANGES[0];
  return { from: new Date(now - preset.ms).toISOString(), to: new Date(now).toISOString(), label: preset.label, preset: preset.value };
}
