import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bucketIndexForLatency, emptyHistogram, percentileFromHistogram } from "@bytedrop/shared";
import { analyticsHourly, deliveryEvents } from "../src/db/schema";
import { queryAnalytics, rollupSince } from "../src/services/analytics";
import { createTestEnv, makeImage, type TestEnv } from "./helpers";

let env: TestEnv;
let cookie: string;
let projectId: string;
let bucketId: string;

beforeAll(async () => {
  env = await createTestEnv();
  const p = await env.setupProject();
  cookie = p.cookie;
  projectId = p.project.id;
  bucketId = (await env.createBucket(cookie, projectId, "stats-bucket", true)).id;
  await env.upload(env.as(cookie), projectId, "stats-bucket", "a.txt", Buffer.alloc(1000, "a"), "text/plain");
  await env.upload(env.as(cookie), projectId, "stats-bucket", "b.txt", Buffer.alloc(500, "b"), "text/plain");
  await env.upload(env.as(cookie), projectId, "stats-bucket", "pic.png", await makeImage(300, 200), "image/png");
});
afterAll(async () => {
  await env.close();
});

const refresh = () =>
  env.app.inject({ method: "POST", url: `/v1/projects/${projectId}/analytics/refresh`, headers: env.as(cookie) });
const get = (qs = "") =>
  env.app.inject({ url: `/v1/projects/${projectId}/analytics?${qs}`, headers: env.as(cookie) });

describe("delivery analytics", () => {
  it("turns delivery requests into hourly summaries", async () => {
    for (let i = 0; i < 6; i++) await env.app.inject({ url: "/f/stats-bucket/a.txt", headers: { referer: "https://blog.example.com/post" } });
    for (let i = 0; i < 2; i++) await env.app.inject({ url: "/f/stats-bucket/b.txt", headers: { referer: "https://shop.example.com/" } });
    const etag = String((await env.app.inject("/f/stats-bucket/b.txt")).headers.etag);
    await env.app.inject({ url: "/f/stats-bucket/b.txt", headers: { "if-none-match": etag } });
    await env.app.inject("/f/stats-bucket/pic.png?w=100&format=webp");
    await env.app.inject("/f/stats-bucket/pic.png?w=100&format=webp");
    await env.app.inject("/f/stats-bucket/missing.txt");

    expect((await refresh()).statusCode).toBe(200);
    const body = (await get()).json();

    // 6 + 2 + 1 + 1 + 2 + 1 (missing file is a request too)
    expect(body.totals.requests).toBe(13);
    expect(body.totals.bandwidth).toBeGreaterThan(6 * 1000 + 3 * 500);
    expect(body.totals.cacheHitRate).toBeGreaterThan(0.8);
    expect(body.totals.cacheHitRate).toBeLessThan(1);
    expect(body.totals.p95Ms).toBeGreaterThanOrEqual(0);

    expect(body.topFiles[0]).toMatchObject({ bucket: "stats-bucket", key: "a.txt", requests: 6 });
    expect(body.topFiles.map((f: { key: string }) => f.key)).not.toContain("missing.txt");
    const refs = Object.fromEntries(body.topReferrers.map((r: { referrer: string; requests: number }) => [r.referrer, r.requests]));
    expect(refs["blog.example.com"]).toBe(6);
    expect(refs["shop.example.com"]).toBe(2);
    expect(refs["(direct)"]).toBeGreaterThanOrEqual(1);

    const slot = body.series.reduce((a: number, p: { requests: number }) => a + p.requests, 0);
    expect(slot).toBe(13);
    expect(body.series.length).toBeGreaterThanOrEqual(24);
  });

  it("is idempotent: recomputing the same hours gives the same numbers", async () => {
    const before = (await get()).json().totals;
    await refresh();
    await refresh();
    expect((await get()).json().totals).toEqual(before);
  });

  it("filters by bucket and file kind", async () => {
    const images = (await get("kind=image")).json();
    expect(images.totals.requests).toBe(2);
    expect(images.topFiles.every((f: { key: string }) => f.key === "pic.png")).toBe(true);
    const none = (await get("bucket=does-not-exist")).json();
    expect(none.totals.requests).toBe(0);
    expect(none.totals.cacheHitRate).toBe(0);
  });

  it("buckets by day for long ranges and rejects invalid ranges", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const week = (await get(`from=${from.toISOString()}&to=${to.toISOString()}`)).json();
    expect(week.series.length).toBeLessThanOrEqual(9);
    expect(week.totals.requests).toBe(13);
    expect((await get(`from=${to.toISOString()}&to=${from.toISOString()}`)).statusCode).toBe(400);
    const huge = new Date(to.getTime() - 200 * 86_400_000);
    expect((await get(`from=${huge.toISOString()}&to=${to.toISOString()}`)).statusCode).toBe(400);
  });

  it("computes p95 latency from merged histograms across hours", async () => {
    const q = await createTestEnv();
    try {
      const p = await q.setupProject();
      const bucket = await q.createBucket(p.cookie, p.project.id, "lat-bucket");
      const hourStart = Math.floor(Date.now() / 3_600_000) * 3_600_000 - 2 * 3_600_000;
      const rows = [];
      for (let ms = 1; ms <= 100; ms++) {
        rows.push({
          projectId: p.project.id,
          bucketId: bucket.id,
          bucket: "lat-bucket",
          objectKey: "x",
          kind: "other",
          status: 200,
          bytes: 10,
          cache: "HIT" as const,
          latencyMs: ms,
          referrer: null,
          createdAt: new Date(hourStart + ms * 1000),
        });
      }
      await q.ctx.db.insert(deliveryEvents).values(rows);
      await rollupSince(q.ctx.pool, new Date(hourStart));
      const a = await queryAnalytics(q.ctx.db, p.project.id, { from: new Date(hourStart).toISOString() });
      expect(a.totals.requests).toBe(100);
      expect(a.totals.p95Ms).toBeGreaterThanOrEqual(90);
      expect(a.totals.p95Ms).toBeLessThanOrEqual(100);
      const [row] = await q.ctx.db.select().from(analyticsHourly);
      expect(row!.p95Ms).toBeGreaterThanOrEqual(94);
    } finally {
      await q.close();
    }
  });

  it("writes events to the database in batches", async () => {
    const before = (await env.ctx.db.select({ n: count() }).from(deliveryEvents))[0]!.n;
    for (let i = 0; i < 40; i++) {
      env.ctx.events.push({
        projectId,
        bucketId,
        bucket: "stats-bucket",
        objectKey: "bulk",
        kind: "text",
        status: 200,
        bytes: 1,
        cache: "HIT",
        latencyMs: 3,
        referrer: null,
      });
    }
    await env.ctx.events.flush();
    const after = (await env.ctx.db.select({ n: count() }).from(deliveryEvents))[0]!.n;
    expect(after - before).toBe(40);
  });

  it("does not leak another project's numbers", async () => {
    const other = await env.setupProject();
    const res = await env.app.inject({ url: `/v1/projects/${projectId}/analytics`, headers: env.as(other.cookie) });
    expect(res.statusCode).toBe(404);
  });
});

describe("latency histogram helpers", () => {
  it("places samples into the right bucket", () => {
    expect(bucketIndexForLatency(0)).toBe(0);
    expect(bucketIndexForLatency(5)).toBe(0);
    expect(bucketIndexForLatency(6)).toBe(1);
    expect(bucketIndexForLatency(99999)).toBe(10);
  });
  it("interpolates percentiles and handles empty input", () => {
    expect(percentileFromHistogram(emptyHistogram(), 0.95)).toBe(0);
    const h = emptyHistogram();
    h[0] = 100;
    expect(percentileFromHistogram(h, 0.95)).toBe(5);
    const spread = emptyHistogram();
    spread[3] = 50; // (25, 50]
    spread[4] = 50; // (50, 100]
    expect(percentileFromHistogram(spread, 0.95)).toBe(95);
  });
});
