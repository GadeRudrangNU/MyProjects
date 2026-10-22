import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startWorkerHttp } from "../src/jobs/handlers";
import { Q } from "../src/jobs/queues";
import { createTestEnv, makeImage, sha256, spanExporter, waitFor, type TestEnv } from "./helpers";
import { startReceiver } from "./receiver";

let env: TestEnv;
let cookie: string;
let projectId: string;
const logLines: string[] = [];

beforeAll(async () => {
  env = await createTestEnv({ WEBHOOK_BACKOFF_MS: 60_000 }, { worker: true, logLines });
  const p = await env.setupProject();
  cookie = p.cookie;
  projectId = p.project.id;
  await env.createBucket(cookie, projectId, "obs-bucket", true);
});
afterAll(async () => {
  await env.close();
});
beforeEach(() => spanExporter.reset());

describe("logging and request ids", () => {
  it("echoes a supplied request id and generates one otherwise", async () => {
    const given = await env.app.inject({ url: "/health", headers: { "x-request-id": "req-abc-123" } });
    expect(given.headers["x-request-id"]).toBe("req-abc-123");
    const generated = await env.app.inject("/health");
    expect(String(generated.headers["x-request-id"])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("puts the request id on every log line for that request and never logs secrets", async () => {
    logLines.length = 0;
    await env.app.inject({
      url: "/v1/projects",
      headers: { "x-request-id": "trace-me-42", authorization: "Bearer bd_live_supersecret" },
    });
    const mine = logLines.map((l) => JSON.parse(l)).filter((l) => l.reqId === "trace-me-42");
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.some((l) => typeof l.traceId === "string")).toBe(true);
    expect(logLines.join("\n")).not.toContain("supersecret");
  });

  it("includes the request id in error bodies", async () => {
    const res = await env.app.inject({ url: "/v1/projects", headers: { "x-request-id": "err-1" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.requestId).toBe("err-1");
  });
});

describe("health and metrics", () => {
  it("reports ready, then 503 when the disk or the database fails", async () => {
    expect((await env.app.inject("/ready")).statusCode).toBe(200);
    const original = env.ctx.storage.checkWritable;
    env.ctx.storage.checkWritable = async () => {
      throw new Error("ENOSPC: no space left on device");
    };
    const disk = await env.app.inject("/ready");
    expect(disk.statusCode).toBe(503);
    expect(disk.json().checks.disk).toContain("ENOSPC");
    expect(disk.json().checks.database).toBe("ok");
    env.ctx.storage.checkWritable = original;

    const pool = env.ctx.pool as unknown as { query: unknown };
    const query = pool.query;
    pool.query = async () => {
      throw new Error("connection refused");
    };
    const db = await env.app.inject("/ready");
    pool.query = query;
    expect(db.statusCode).toBe(503);
    expect(db.json().checks.database).toContain("connection refused");
  });

  it("exposes latency histograms, cache counters, upload failures, webhook backlog and job failures", async () => {
    await env.app.inject("/health");
    await env.app.inject("/f/obs-bucket/nothing");
    const text = (await env.app.inject("/metrics")).body;
    for (const name of [
      "bytedrop_http_request_duration_seconds",
      "bytedrop_cache_events_total",
      "bytedrop_upload_failures_total",
      "bytedrop_webhook_backlog",
      "bytedrop_job_failures_total",
      "bytedrop_job_duration_seconds",
      "process_cpu_user_seconds_total",
    ]) {
      expect(text, name).toContain(name);
    }
    expect(text).toMatch(/bytedrop_http_request_duration_seconds_count\{method="GET",route="\/health",status="200"\} [1-9]/);
  });

  it("counts failed jobs", async () => {
    await env.runtime.boss!.send(Q.thumbnail, { blobHash: "0".repeat(64), contentType: "image/png" });
    await waitFor(
      async () => /bytedrop_job_failures_total\{queue="thumbnail.generate"\} [1-9]/.test((await env.app.inject("/metrics")).body),
      15_000,
    );
  });

  it("runs scheduled jobs that have no payload", async () => {
    await env.runtime.boss!.send(Q.rollup);
    await waitFor(
      async () => /bytedrop_job_duration_seconds_count\{queue="analytics\.rollup"\} [1-9]/.test((await env.app.inject("/metrics")).body),
      15_000,
    );
    expect((await env.app.inject("/metrics")).body).not.toMatch(/bytedrop_job_failures_total\{queue="analytics\.rollup"\}/);
  });

  it("shows the webhook backlog growing while a receiver is unreachable", async () => {
    await env.app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/webhooks`,
      headers: env.as(cookie),
      payload: { url: "http://127.0.0.1:1/dead", events: ["object.created"] },
    });
    for (let i = 0; i < 3; i++) await env.upload(env.as(cookie), projectId, "obs-bucket", `b${i}.bin`, randomBytes(16));
    const backlog = await waitFor(async () => {
      const m = /bytedrop_webhook_backlog (\d+)/.exec((await env.app.inject("/metrics")).body);
      return m && Number(m[1]) >= 3 ? Number(m[1]) : undefined;
    }, 10_000);
    expect(backlog).toBeGreaterThanOrEqual(3);
  });

  it("serves liveness, readiness and metrics from the worker process", async () => {
    const server = startWorkerHttp(env.ctx, 0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      expect((await fetch(`${base}/ready`)).status).toBe(200);
      expect(await (await fetch(`${base}/metrics`)).text()).toContain("bytedrop_job_duration_seconds");
    } finally {
      server.close();
    }
  });
});

describe("background jobs and tracing", () => {
  it("warms a thumbnail in the worker after an image upload", async () => {
    const png = await makeImage(640, 480);
    const res = await env.upload(env.as(cookie), projectId, "obs-bucket", "thumb.png", png, "image/png");
    expect(res.statusCode).toBe(201);
    const key = env.ctx.transformer.keyFor(sha256(png), "image/png", { w: 256, q: 75, fit: "inside", format: "webp" });
    await waitFor(() => env.ctx.transformCache.has(key));
  });

  it("follows a request into the worker job it caused (shared trace id)", async () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const png = await makeImage(320, 240, { r: 10, g: 200, b: 120 });
    const res = await env.upload(
      { ...env.as(cookie), traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
      projectId,
      "obs-bucket",
      "traced.png",
      png,
      "image/png",
    );
    expect(res.statusCode).toBe(201);
    const job = await waitFor(
      async () => spanExporter.getFinishedSpans().find((s) => s.name === "job thumbnail.generate" && s.spanContext().traceId === traceId),
      10_000,
    );
    expect(job.spanContext().traceId).toBe(traceId);
    const http = spanExporter
      .getFinishedSpans()
      .find((s) => s.name.startsWith("POST /v1/projects/:projectId/buckets/:bucket/objects"));
    expect(http?.spanContext().traceId).toBe(traceId);
    expect(http?.attributes["http.status_code"]).toBe(201);
  });

  it("carries the trace through the outbox into webhook delivery", async () => {
    const traceId = "11111111111111111111111111111111";
    const rx = await startReceiver();
    await env.app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/webhooks`,
      headers: env.as(cookie),
      payload: { url: rx.url, events: ["object.deleted"] },
    });
    await env.upload(env.as(cookie), projectId, "obs-bucket", "gone.bin", randomBytes(8));
    spanExporter.reset();
    await env.app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/buckets/obs-bucket/objects?key=gone.bin`,
      headers: { ...env.as(cookie), traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    });
    await waitFor(async () => rx.hits.length > 0);
    const span = await waitFor(async () =>
      spanExporter.getFinishedSpans().find((s) => s.name === "job webhook.deliver" && s.spanContext().traceId === traceId),
    );
    expect(span).toBeTruthy();
    await rx.close();
  });
});
