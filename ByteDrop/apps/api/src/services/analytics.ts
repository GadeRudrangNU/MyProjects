import {
  LATENCY_BOUNDS_MS,
  emptyHistogram,
  percentileFromHistogram,
  type Analytics,
  type AnalyticsQuery,
} from "@bytedrop/shared";
import { and, eq, gte, lte } from "drizzle-orm";
import type pg from "pg";
import type { AppContext } from "../context";
import type { Db } from "../db/client";
import { analyticsHourly } from "../db/schema";
import { HttpError } from "../util";

const HOUR = 3_600_000;
const floorHour = (d: Date) => new Date(Math.floor(d.getTime() / HOUR) * HOUR);
const HOUR_EXPR = "to_timestamp(floor(extract(epoch from created_at) / 3600) * 3600)";
const TOP_N = 10;

function histColumns() {
  const cols: string[] = [];
  LATENCY_BOUNDS_MS.forEach((hi, i) => {
    const lo = i === 0 ? -1 : LATENCY_BOUNDS_MS[i - 1];
    cols.push(`count(*) filter (where latency_ms > ${lo} and latency_ms <= ${hi})::int as h${i}`);
  });
  cols.push(`count(*) filter (where latency_ms > ${LATENCY_BOUNDS_MS[LATENCY_BOUNDS_MS.length - 1]})::int as h${LATENCY_BOUNDS_MS.length}`);
  return cols.join(", ");
}

function topN<T>(entries: [string, T][], score: (v: T) => number): Record<string, T> {
  return Object.fromEntries(entries.sort((a, b) => score(b[1]) - score(a[1])).slice(0, TOP_N));
}

/**
 * Recomputes hourly summaries from raw delivery events for every hour since `since`.
 * Idempotent: the affected hours are replaced inside one transaction.
 */
export async function rollupSince(pool: pg.Pool, since: Date): Promise<number> {
  const from = floorHour(since);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const agg = await client.query(
      `select project_id, bucket_id, bucket, kind, ${HOUR_EXPR} as hour,
              count(*)::int as requests,
              coalesce(sum(bytes), 0)::float8 as bytes,
              count(*) filter (where cache in ('HIT','REVALIDATED'))::int as hits,
              count(*) filter (where cache = 'MISS')::int as misses,
              coalesce(percentile_cont(0.95) within group (order by latency_ms), 0)::int as p95,
              ${histColumns()}
         from delivery_events
        where created_at >= $1
        group by project_id, bucket_id, bucket, kind, 5`,
      [from],
    );
    const files = await client.query(
      `select bucket_id, kind, ${HOUR_EXPR} as hour, object_key, count(*)::int as c, coalesce(sum(bytes), 0)::float8 as b
         from delivery_events where created_at >= $1 and status < 400
        group by bucket_id, kind, 3, object_key`,
      [from],
    );
    const refs = await client.query(
      `select bucket_id, kind, ${HOUR_EXPR} as hour, coalesce(referrer, '(direct)') as r, count(*)::int as c
         from delivery_events where created_at >= $1
        group by bucket_id, kind, 3, 4`,
      [from],
    );

    const gk = (bucketId: string, kind: string, hour: Date) => `${bucketId}|${kind}|${hour.getTime()}`;
    const fileMap = new Map<string, [string, { requests: number; bytes: number }][]>();
    for (const r of files.rows) {
      const k = gk(r.bucket_id, r.kind, r.hour);
      (fileMap.get(k) ?? fileMap.set(k, []).get(k)!).push([r.object_key, { requests: r.c, bytes: r.b }]);
    }
    const refMap = new Map<string, [string, number][]>();
    for (const r of refs.rows) {
      const k = gk(r.bucket_id, r.kind, r.hour);
      (refMap.get(k) ?? refMap.set(k, []).get(k)!).push([r.r, r.c]);
    }

    await client.query("delete from analytics_hourly where hour >= $1", [from]);
    for (const r of agg.rows) {
      const k = gk(r.bucket_id, r.kind, r.hour);
      const hist = LATENCY_BOUNDS_MS.map((_, i) => r[`h${i}`] as number);
      hist.push(r[`h${LATENCY_BOUNDS_MS.length}`] as number);
      await client.query(
        `insert into analytics_hourly
           (project_id, bucket_id, bucket, kind, hour, requests, bytes, cache_hits, cache_misses, p95_ms, latency_hist, top_files, top_referrers)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          r.project_id,
          r.bucket_id,
          r.bucket,
          r.kind,
          r.hour,
          r.requests,
          r.bytes,
          r.hits,
          r.misses,
          r.p95,
          JSON.stringify(hist),
          JSON.stringify(topN(fileMap.get(k) ?? [], (v) => v.requests)),
          JSON.stringify(topN(refMap.get(k) ?? [], (v) => v)),
        ],
      );
    }
    await client.query("commit");
    return agg.rows.length;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function pruneEvents(pool: pg.Pool, olderThanDays = 7) {
  const r = await pool.query("delete from delivery_events where created_at < now() - ($1 || ' days')::interval", [
    String(olderThanDays),
  ]);
  return r.rowCount ?? 0;
}

export async function queryAnalytics(db: Db, projectId: string, q: AnalyticsQuery): Promise<Analytics> {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 24 * HOUR);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new HttpError(400, "invalid_range", "`from` must be before `to`");
  }
  if (to.getTime() - from.getTime() > 90 * 24 * HOUR) {
    throw new HttpError(400, "range_too_large", "Maximum range is 90 days");
  }
  const bucketBy = q.granularity ?? (to.getTime() - from.getTime() > 72 * HOUR ? "day" : "hour");
  const step = bucketBy === "day" ? 24 * HOUR : HOUR;
  const align = (t: number) => Math.floor(t / step) * step;

  const conds = [
    eq(analyticsHourly.projectId, projectId),
    gte(analyticsHourly.hour, floorHour(from)),
    lte(analyticsHourly.hour, to),
  ];
  if (q.bucket) conds.push(eq(analyticsHourly.bucket, q.bucket));
  if (q.kind) conds.push(eq(analyticsHourly.kind, q.kind));
  const rows = await db.select().from(analyticsHourly).where(and(...conds));

  interface Acc {
    requests: number;
    bytes: number;
    hits: number;
    misses: number;
    hist: number[];
  }
  const fresh = (): Acc => ({ requests: 0, bytes: 0, hits: 0, misses: 0, hist: emptyHistogram() });
  const add = (a: Acc, r: (typeof rows)[number]) => {
    a.requests += r.requests;
    a.bytes += r.bytes;
    a.hits += r.cacheHits;
    a.misses += r.cacheMisses;
    r.latencyHist.forEach((c, i) => (a.hist[i] = (a.hist[i] ?? 0) + c));
  };

  const total = fresh();
  const slots = new Map<number, Acc>();
  const files = new Map<string, { bucket: string; key: string; requests: number; bytes: number }>();
  const referrers = new Map<string, number>();
  for (const r of rows) {
    add(total, r);
    const slot = align(r.hour.getTime());
    add(slots.get(slot) ?? slots.set(slot, fresh()).get(slot)!, r);
    for (const [key, v] of Object.entries(r.topFiles)) {
      const id = `${r.bucket}/${key}`;
      const cur = files.get(id) ?? { bucket: r.bucket, key, requests: 0, bytes: 0 };
      cur.requests += v.requests;
      cur.bytes += v.bytes;
      files.set(id, cur);
    }
    for (const [ref, n] of Object.entries(r.topReferrers)) referrers.set(ref, (referrers.get(ref) ?? 0) + n);
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
    topReferrers: [...referrers.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([referrer, requests]) => ({ referrer, requests })),
  };
}

export async function refreshAnalytics(ctx: AppContext, hours = 3) {
  await ctx.events.flush();
  return rollupSince(ctx.pool, new Date(Date.now() - hours * HOUR));
}
