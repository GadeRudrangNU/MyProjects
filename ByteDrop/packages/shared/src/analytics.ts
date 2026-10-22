import { z } from "zod";
import { fileKindSchema } from "./common";

export const analyticsQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  bucket: z.string().optional(),
  kind: fileKindSchema.optional(),
  granularity: z.enum(["hour", "day"]).optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuery>;

export const seriesPointSchema = z.object({
  hour: z.string(),
  requests: z.number(),
  bandwidth: z.number(),
  cacheHitRate: z.number(),
  p95Ms: z.number(),
});
export type SeriesPoint = z.infer<typeof seriesPointSchema>;

export const analyticsSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object({
    requests: z.number(),
    bandwidth: z.number(),
    cacheHitRate: z.number(),
    p95Ms: z.number(),
  }),
  series: z.array(seriesPointSchema),
  topFiles: z.array(
    z.object({ bucket: z.string(), key: z.string(), requests: z.number(), bytes: z.number() }),
  ),
  topReferrers: z.array(z.object({ referrer: z.string(), requests: z.number() })),
});
export type Analytics = z.infer<typeof analyticsSchema>;

export const LATENCY_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 10000] as const;
const LAST_BOUND = LATENCY_BOUNDS_MS[LATENCY_BOUNDS_MS.length - 1]!;

export function percentileFromHistogram(counts: number[], p: number): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i] ?? 0;
    if (c > 0 && acc + c >= target) {
      const lo = i === 0 ? 0 : (LATENCY_BOUNDS_MS[i - 1] ?? 0);
      const hi = LATENCY_BOUNDS_MS[i] ?? LAST_BOUND;
      return Math.round(lo + ((target - acc) / c) * (hi - lo));
    }
    acc += c;
  }
  return LAST_BOUND;
}

export function bucketIndexForLatency(ms: number): number {
  for (let i = 0; i < LATENCY_BOUNDS_MS.length; i++) if (ms <= LATENCY_BOUNDS_MS[i]!) return i;
  return LATENCY_BOUNDS_MS.length;
}

export const emptyHistogram = () => new Array<number>(LATENCY_BOUNDS_MS.length + 1).fill(0);
