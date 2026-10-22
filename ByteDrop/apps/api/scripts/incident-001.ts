// Reproduces the webhook incident described in docs/POSTMORTEM-001.md with real components:
// one receiver that stops answering and one healthy receiver, subscribed to the same events.
// It runs the delivery pipeline twice, first with the settings the service originally shipped with and then with the fix,
// and writes the measurements to docs/incident-001-data.json.
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import pg from "pg";
import { loadConfig, type Config } from "../src/config";
import { runMigrations } from "../src/db/client";
import { startEmbeddedPostgres } from "../src/db/embedded";
import { projects, user, webhookDeliveries, webhookEndpoints } from "../src/db/schema";
import { registerWorkers, startOutboxRelay } from "../src/jobs/handlers";
import { commitObject } from "../src/services/objects";
import { createRuntime } from "../src/runtime";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const EVENTS = Number(process.env.INCIDENT_EVENTS ?? 24);
const DEADLINE_MS = Number(process.env.INCIDENT_DEADLINE_MS ?? 120_000);

interface Scenario {
  name: string;
  description: string;
  env: Partial<Config>;
}

const scenarios: Scenario[] = [
  {
    name: "before",
    description: "Original settings: long receiver timeout, no circuit breaker, 2 delivery slots",
    env: { WEBHOOK_TIMEOUT_MS: 8000, WEBHOOK_BREAKER: "off", WEBHOOK_CONCURRENCY: 2 },
  },
  {
    name: "after",
    description: "Fixed settings: short receiver timeout and a per-endpoint circuit breaker, same 2 slots",
    env: { WEBHOOK_TIMEOUT_MS: 1000, WEBHOOK_BREAKER: "on", WEBHOOK_BREAKER_THRESHOLD: 3, WEBHOOK_BREAKER_COOLDOWN_MS: 30_000, WEBHOOK_CONCURRENCY: 2 },
  },
];

function receiver(behaviour: "ok" | "hang") {
  const sockets = new Set<import("node:net").Socket>();
  let hits = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      hits++;
      if (behaviour === "ok") res.writeHead(200).end("ok");
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise<{ url: string; hits: () => number; close: () => Promise<void> }>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`,
        hits: () => hits,
        close: async () => {
          for (const s of sockets) s.destroy();
          await new Promise((r) => server.close(r));
        },
      }),
    ),
  );
}

async function run(scenario: Scenario, baseUrl: (db: string) => string, admin: pg.Client, dataRoot: string) {
  const dbName = `incident_${scenario.name}`;
  await admin.query(`create database ${dbName}`);
  const cfg = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: baseUrl(dbName),
    DATA_DIR: path.join(dataRoot, scenario.name),
    LOG_LEVEL: "silent",
    WEBHOOK_BACKOFF_MS: 4000,
    WEBHOOK_MAX_ATTEMPTS: 6,
    ...scenario.env,
  });
  const runtime = await createRuntime(cfg, { service: "worker" });
  const { ctx } = runtime;
  await runMigrations(ctx.db);
  await registerWorkers(ctx, runtime.boss!);
  const stopRelay = startOutboxRelay(ctx, 100);

  const healthy = await receiver("ok");
  const stuck = await receiver("hang");

  await ctx.db.insert(user).values({ id: "u1", name: "Incident", email: "incident@example.com" });
  const [project] = await ctx.db.insert(projects).values({ ownerId: "u1", name: "incident", quotaBytes: 1 << 30 }).returning();
  const projectId = project!.id;
  const bucket = { id: crypto.randomUUID(), name: "incident-bucket", projectId };
  const { buckets } = await import("../src/db/schema");
  await ctx.db.insert(buckets).values({ id: bucket.id, projectId, name: bucket.name, isPublic: true });
  const events = ["object.created"];
  // The unresponsive endpoint is registered first, so it is always ahead in the queue.
  const [stuckEp] = await ctx.db.insert(webhookEndpoints).values({ projectId, url: stuck.url, secret: "s1", events }).returning();
  const [okEp] = await ctx.db.insert(webhookEndpoints).values({ projectId, url: healthy.url, secret: "s2", events }).returning();

  const started = Date.now();
  const timeline: { t: number; backlog: number; healthyDelivered: number; stuckAttempts: number }[] = [];
  const sample = async () => {
    const rows = await ctx.db.select().from(webhookDeliveries);
    timeline.push({
      t: Math.round((Date.now() - started) / 100) / 10,
      backlog: rows.filter((r) => r.status === "pending").length,
      healthyDelivered: rows.filter((r) => r.endpointId === okEp!.id && r.status === "success").length,
      stuckAttempts: rows.filter((r) => r.endpointId === stuckEp!.id).reduce((a, r) => a + r.attempts, 0),
    });
  };

  // Files arrive at five per second.
  for (let i = 0; i < EVENTS; i++) {
    const data = Buffer.from(`file ${i} ${Math.random()}`);
    const tmp = ctx.storage.tempPath(`inc-${i}`);
    await writeFile(tmp, data);
    await commitObject(ctx, {
      bucket,
      key: `f/${i}.txt`,
      tmpFile: tmp,
      hash: createHash("sha256").update(data).digest("hex"),
      size: data.length,
      contentType: "text/plain",
    });
    await new Promise((r) => setTimeout(r, 200));
    if (i % 2 === 0) await sample();
  }

  let allHealthyAt: number | null = null;
  while (Date.now() - started < DEADLINE_MS) {
    await sample();
    const last = timeline[timeline.length - 1]!;
    if (last.healthyDelivered >= EVENTS) {
      allHealthyAt = (Date.now() - started) / 1000;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await sample();

  const okRows = await ctx.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, okEp!.id));
  const lags = okRows
    .filter((r) => r.status === "success")
    .map((r) => (r.updatedAt.getTime() - r.createdAt.getTime()) / 1000)
    .sort((a, b) => a - b);
  const pct = (p: number) => lags[Math.min(lags.length - 1, Math.floor(lags.length * p))] ?? null;
  const metrics = await ctx.metrics.registry.getSingleMetricAsString("bytedrop_webhook_attempts_total");

  const result = {
    scenario: scenario.name,
    description: scenario.description,
    settings: scenario.env,
    events: EVENTS,
    healthyDelivered: okRows.filter((r) => r.status === "success").length,
    secondsUntilAllHealthyDelivered: allHealthyAt,
    healthyLagSeconds: { p50: pct(0.5), p95: pct(0.95), max: lags[lags.length - 1] ?? null },
    peakBacklog: Math.max(...timeline.map((s) => s.backlog)),
    attemptsAtStuckReceiver: stuck.hits(),
    attemptOutcomes: metrics
      .split("\n")
      .filter((l) => l.startsWith("bytedrop_webhook_attempts_total{"))
      .map((l) => l.replace("bytedrop_webhook_attempts_total", "").trim()),
    timeline,
  };

  stopRelay();
  await runtime.close();
  await healthy.close();
  await stuck.close();
  return result;
}

const dir = mkdtempSync(path.join(os.tmpdir(), "bytedrop-incident-"));
const port = 54350;
const embedded = await startEmbeddedPostgres({ dir: path.join(dir, "pg"), port, persistent: false });
const admin = new pg.Client({ connectionString: embedded.url("postgres") });
await admin.connect();

const results = [];
try {
  for (const s of scenarios) {
    console.log(`Running "${s.name}": ${s.description}`);
    const r = await run(s, (db) => embedded.url(db), admin, dir);
    console.log(
      `  healthy receiver got ${r.healthyDelivered}/${r.events}; all delivered after ${r.secondsUntilAllHealthyDelivered?.toFixed(1) ?? "never (deadline)"} s; ` +
        `p95 lag ${r.healthyLagSeconds.p95?.toFixed(1)} s; peak backlog ${r.peakBacklog}; attempts at stuck receiver ${r.attemptsAtStuckReceiver}`,
    );
    results.push(r);
  }
  const out = path.resolve(process.argv[2] ?? "../../docs/incident-001-data.json");
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`Wrote ${out}`);
} finally {
  await admin.end();
  await embedded.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  process.exit(0);
}
