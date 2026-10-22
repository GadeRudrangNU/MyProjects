import {
  bucketIndexForLatency,
  emptyHistogram,
  percentileFromHistogram,
  type Analytics,
  type AnalyticsQuery,
} from "@bytedrop/shared";

const HOUR = 3_600_000;

function noise(seed: number) {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

const COMBOS = [
  { bucket: "acme-assets", kind: "image", weight: 1, avgBytes: 220_000 },
  { bucket: "acme-assets", kind: "text", weight: 0.12, avgBytes: 900 },
  { bucket: "acme-assets", kind: "pdf", weight: 0.05, avgBytes: 60_000 },
  { bucket: "acme-archive", kind: "text", weight: 0.2, avgBytes: 30 },
] as const;

const FILES: Record<string, string[]> = {
  image: ["hero/shot-01.png", "hero/shot-03.jpg", "products/shot-07.png", "blog/shot-12.webp", "brand/logo.svg"],
  pdf: ["docs/handbook.pdf"],
  text: ["data/export.csv", "data/readme.txt"],
};
const REFERRERS = ["www.acme.dev", "shop.acme.dev", "news.ycombinator.com", "(direct)", "blog.example.org"];

interface Row {
  hour: number;
  bucket: string;
  kind: string;
  requests: number;
  bytes: number;
  hits: number;
  misses: number;
  hist: number[];
}

function rowFor(hour: number, c: (typeof COMBOS)[number], ci: number): Row {
  const idx = Math.floor(hour / HOUR);
  const hod = new Date(hour).getUTCHours();
  const rhythm = 0.55 + 0.45 * Math.sin(((hod - 8) / 24) * 2 * Math.PI);
  const requests = Math.max(1, Math.round(c.weight * (900 * rhythm + noise(idx + ci * 977) * 160)));
  const hitRate = 0.9 + noise(idx * 3 + ci) * 0.08;
  const hits = Math.round(requests * hitRate);
  const hist = emptyHistogram();
  const spike = noise(idx * 7) > 0.97 ? 6 : 1;
  const n = Math.min(requests, 60);
  for (let s = 0; s < n; s++) {
    const ms = Math.round(4 + Math.exp(noise(idx * 31 + s + ci) * 3.2) * (c.kind === "image" ? 3 : 1.4) * spike);
    hist[bucketIndexForLatency(ms)]! += Math.max(1, Math.round(requests / n));
  }
  return { hour, bucket: c.bucket, kind: c.kind, requests, bytes: requests * c.avgBytes, hits, misses: requests - hits, hist };
}

export function demoAnalytics(q: AnalyticsQuery, now = Date.now()): Analytics {
  const to = q.to ? new Date(q.to) : new Date(now);
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * HOUR);
  const span = to.getTime() - from.getTime();
  const day = (q.granularity ?? (span > 72 * HOUR ? "day" : "hour")) === "day";
  const step = day ? 24 * HOUR : HOUR;
  const align = (t: number) => Math.floor(t / step) * step;

  interface Acc {
    requests: number;
    bytes: number;
    hits: number;
    misses: number;
    hist: number[];
  }
  const fresh = (): Acc => ({ requests: 0, bytes: 0, hits: 0, misses: 0, hist: emptyHistogram() });
  const total = fresh();
  const slots = new Map<number, Acc>();
  const files = new Map<string, { bucket: string; key: string; requests: number; bytes: number }>();
  const refs = new Map<string, number>();

  for (let h = Math.floor(from.getTime() / HOUR) * HOUR; h <= to.getTime() && h <= now; h += HOUR) {
    COMBOS.forEach((c, ci) => {
      if (q.bucket && q.bucket !== c.bucket) return;
      if (q.kind && q.kind !== c.kind) return;
      const r = rowFor(h, c, ci);
      for (const a of [total, slots.get(align(h)) ?? slots.set(align(h), fresh()).get(align(h))!]) {
        a.requests += r.requests;
        a.bytes += r.bytes;
        a.hits += r.hits;
        a.misses += r.misses;
        r.hist.forEach((v, i) => (a.hist[i] = (a.hist[i] ?? 0) + v));
      }
      FILES[c.kind]!.forEach((key, i) => {
        const share = Math.round(r.requests * (0.4 / (i + 1)));
        const id = `${c.bucket}/${key}`;
        const cur = files.get(id) ?? { bucket: c.bucket, key, requests: 0, bytes: 0 };
        cur.requests += share;
        cur.bytes += share * c.avgBytes;
        files.set(id, cur);
      });
      REFERRERS.forEach((ref, i) => refs.set(ref, (refs.get(ref) ?? 0) + Math.round(r.requests * (0.45 / (i + 1)))));
    });
  }

  const rate = (a: Acc) => (a.hits + a.misses === 0 ? 0 : a.hits / (a.hits + a.misses));
  const series = [];
  for (let t = align(from.getTime()); t <= to.getTime(); t += step) {
    const a = slots.get(t) ?? fresh();
    series.push({
      hour: new Date(t).toISOString(),
      requests: a.requests,
      bandwidth: a.bytes,
      cacheHitRate: Number(rate(a).toFixed(4)),
      p95Ms: percentileFromHistogram(a.hist, 0.95),
    });
  }
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      requests: total.requests,
      bandwidth: total.bytes,
      cacheHitRate: Number(rate(total).toFixed(4)),
      p95Ms: percentileFromHistogram(total.hist, 0.95),
    },
    series,
    topFiles: [...files.values()].sort((a, b) => b.requests - a.requests).slice(0, 10),
    topReferrers: [...refs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([referrer, requests]) => ({ referrer, requests })),
  };
}
