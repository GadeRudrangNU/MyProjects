import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import pg from "pg";
import pino from "pino";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth";
import { loadConfig, type Config } from "../src/config";
import { runMigrations } from "../src/db/client";
import { registerWorkers, startOutboxRelay } from "../src/jobs/handlers";
import { createRuntime } from "../src/runtime";
import { initTelemetry } from "../src/telemetry";

export const spanExporter = new InMemorySpanExporter();
initTelemetry("bytedrop-test", {}, [new SimpleSpanProcessor(spanExporter)]);

export const ORIGIN = "http://localhost:3000";
export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export async function createTestEnv(
  overrides: Partial<Config> = {},
  opts: { worker?: boolean; logLines?: string[] } = {},
) {
  const port = process.env.TEST_PG_PORT;
  const admin = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` });
  await admin.connect();
  const dbName = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const dataDir = mkdtempSync(path.join(os.tmpdir(), "bytedrop-data-"));
  const cfg = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/${dbName}`,
    DATA_DIR: dataDir,
    LOG_LEVEL: "silent",
    RATE_LIMIT_PER_MIN: 100_000,
    WEBHOOK_BACKOFF_MS: 40,
    WEBHOOK_TIMEOUT_MS: 800,
    WEBHOOK_BREAKER_COOLDOWN_MS: 300,
    ...overrides,
  });

  const log = opts.logLines
    ? pino({ level: "info" }, { write: (line: string) => void opts.logLines!.push(line) })
    : undefined;
  const runtime = await createRuntime(cfg, { service: opts.worker ? "worker" : "api", log });
  const { ctx } = runtime;
  await runMigrations(ctx.db);
  let stopRelay = () => {};
  if (opts.worker) {
    await registerWorkers(ctx, runtime.boss!);
    stopRelay = startOutboxRelay(ctx, 100);
  }
  const auth = createAuth(ctx.db, cfg);
  const app = await buildApp(ctx, auth);
  await app.ready();

  async function signUp(email = `u${randomUUID().slice(0, 8)}@example.com`) {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      payload: { email, password: "correct-horse-battery", name: "Test User" },
    });
    if (res.statusCode !== 200) throw new Error(`sign-up failed ${res.statusCode}: ${res.body}`);
    const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    return { cookie, email };
  }

  const as = (cookie: string) => ({ cookie, origin: ORIGIN });
  const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

  async function setupProject(name = "demo") {
    const { cookie } = await signUp();
    const p = await app.inject({ method: "POST", url: "/v1/projects", headers: as(cookie), payload: { name } });
    return { cookie, project: p.json() as { id: string; quotaBytes: number } };
  }

  async function createKey(cookie: string, projectId: string, scope: "read" | "write" = "write") {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/keys`,
      headers: as(cookie),
      payload: { name: `k-${scope}`, scope },
    });
    return res.json() as { id: string; secret: string };
  }

  async function createBucket(cookie: string, projectId: string, name: string, isPublic = true) {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/buckets`,
      headers: as(cookie),
      payload: { name, isPublic },
    });
    if (res.statusCode !== 201) throw new Error(res.body);
    return res.json();
  }

  async function upload(
    headers: Record<string, string>,
    projectId: string,
    bucket: string,
    key: string,
    data: Buffer,
    contentType?: string,
  ) {
    const boundary = `----bd${randomUUID()}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(key)}"\r\nContent-Type: ${contentType ?? "application/octet-stream"}\r\n\r\n`,
    );
    const body = Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/buckets/${bucket}/objects?key=${encodeURIComponent(key)}`,
      headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  }

  async function close() {
    stopRelay();
    await app.close();
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  }

  return { app, ctx, cfg, runtime, signUp, as, bearer, setupProject, createKey, createBucket, upload, close };
}

export type TestEnv = Awaited<ReturnType<typeof createTestEnv>>;

export async function makeImage(width = 800, height = 600, color = { r: 200, g: 60, b: 90 }) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

export async function waitFor<T>(fn: () => Promise<T | undefined | false>, timeoutMs = 10_000, everyMs = 100): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
