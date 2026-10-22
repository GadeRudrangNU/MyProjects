interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface LimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

/** Token bucket per caller; refills continuously so a burst is allowed but sustained load is capped. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(id: string): LimitResult {
    const t = this.now();
    const rate = this.perMinute / 60_000;
    let b = this.buckets.get(id);
    if (!b) {
      b = { tokens: this.perMinute, updatedAt: t };
      this.buckets.set(id, b);
    } else {
      b.tokens = Math.min(this.perMinute, b.tokens + (t - b.updatedAt) * rate);
      b.updatedAt = t;
    }
    if (this.buckets.size > 20_000) this.sweep(t);

    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, limit: this.perMinute, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
    }
    const retryAfterSec = Math.max(1, Math.ceil((1 - b.tokens) / rate / 1000));
    return { ok: false, limit: this.perMinute, remaining: 0, retryAfterSec };
  }

  private sweep(t: number) {
    for (const [k, b] of this.buckets) if (t - b.updatedAt > 120_000) this.buckets.delete(k);
  }
}
