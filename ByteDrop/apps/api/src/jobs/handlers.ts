import http from "node:http";
import { rm } from "node:fs/promises";
import { and, eq, lt, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { AppContext } from "../context";
import { blobs, uploadSessions, webhookDeliveries, buckets } from "../db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { emitEvent } from "../services/objects";
import { pruneEvents, rollupSince } from "../services/analytics";
import { dispatchOutbox, WebhookSender } from "../services/webhooks";
import { withSpan } from "../telemetry";
import { Q, type JobData, type QueueName } from "./queues";

export const GC_GRACE_MS_DEFAULT = 5 * 60 * 1000;

export async function collectGarbage(ctx: AppContext, graceMs = GC_GRACE_MS_DEFAULT) {
  const stats = { blobs: 0, bytes: 0, uploads: 0, events: 0 };

  const candidates = await ctx.db
    .select({ hash: blobs.hash })
    .from(blobs)
    .where(and(eq(blobs.refCount, 0), lt(blobs.zeroSince, new Date(Date.now() - graceMs))))
    .limit(500);

  for (const { hash } of candidates) {
    const client = await ctx.pool.connect();
    try {
      await client.query("begin");
      const tx = drizzle(client, { schema });
      // Lock the row first: a concurrent upload of the same content blocks here until we finish,
      // then re-creates the blob, so the file is never deleted from under a live reference.
      const [row] = await tx
        .select()
        .from(blobs)
        .where(and(eq(blobs.hash, hash), eq(blobs.refCount, 0)))
        .for("update", { skipLocked: true });
      if (row) {
        await ctx.storage.remove(hash);
        await tx.delete(blobs).where(eq(blobs.hash, hash));
        stats.blobs++;
        stats.bytes += row.size;
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      ctx.log.error({ err, hash }, "gc failed for blob");
    } finally {
      client.release();
    }
  }

  const stale = await ctx.db
    .select({ s: uploadSessions, bucket: buckets.name })
    .from(uploadSessions)
    .innerJoin(buckets, eq(buckets.id, uploadSessions.bucketId))
    .where(and(eq(uploadSessions.status, "active"), lt(uploadSessions.expiresAt, new Date())))
    .limit(200);
  for (const { s, bucket } of stale) {
    await ctx.db.transaction(async (tx) => {
      await tx.update(uploadSessions).set({ status: "failed" }).where(eq(uploadSessions.id, s.id));
      await emitEvent(tx, s.projectId, "upload.failed", { uploadId: s.id, bucket, key: s.key, reason: "expired" });
    });
    ctx.metrics.uploadFailures.inc({ reason: "expired" });
    await rm(ctx.storage.tempPath(`upload-${s.id}`), { force: true });
    stats.uploads++;
  }

  stats.events = await pruneEvents(ctx.pool, 7);
  return stats;
}

export async function registerWorkers(ctx: AppContext, boss: PgBoss) {
  const sender = new WebhookSender(ctx);

  const instrument =
    <T extends JobData>(queue: QueueName, fn: (data: T) => Promise<void>) =>
    async (jobs: { id: string; data: T | null }[]) => {
      for (const job of jobs) {
        // Scheduled (cron) jobs carry no payload.
        const data = (job.data ?? {}) as T;
        const timer = ctx.metrics.jobDuration.startTimer({ queue });
        try {
          await withSpan(`job ${queue}`, data._trace, { "job.id": job.id, "job.queue": queue }, () => fn(data));
        } catch (err) {
          ctx.metrics.jobFailures.inc({ queue });
          ctx.log.error({ err, queue, jobId: job.id }, "job failed");
          throw err;
        } finally {
          timer();
        }
      }
    };

  await boss.work<JobData & { blobHash: string; contentType: string }>(
    Q.thumbnail,
    { pollingIntervalSeconds: 0.5, localConcurrency: 2 },
    instrument(Q.thumbnail, async (data) => {
      await ctx.transformer.get(data.blobHash, data.contentType, { w: 256, q: 75, fit: "inside", format: "webp" });
    }),
  );

  await boss.work<JobData & { deliveryId: string }>(
    Q.webhook,
    { pollingIntervalSeconds: 0.5, localConcurrency: ctx.cfg.WEBHOOK_CONCURRENCY },
    instrument(Q.webhook, (data) => sender.attempt(data.deliveryId)),
  );

  await boss.work<JobData>(
    Q.rollup,
    { pollingIntervalSeconds: 5 },
    instrument(Q.rollup, async () => {
      await ctx.events.flush();
      await rollupSince(ctx.pool, new Date(Date.now() - 3 * 3_600_000));
    }),
  );

  await boss.work<JobData>(
    Q.gc,
    { pollingIntervalSeconds: 10 },
    instrument(Q.gc, async () => {
      const stats = await collectGarbage(ctx);
      ctx.log.info(stats, "gc finished");
    }),
  );

  await boss.schedule(Q.rollup, "* * * * *");
  await boss.schedule(Q.gc, "*/10 * * * *");
}

/** Polls the outbox so committed events reach webhook endpoints within about a second. */
export function startOutboxRelay(ctx: AppContext, intervalMs = 500) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      while ((await dispatchOutbox(ctx)) > 0);
    } catch (err) {
      ctx.log.error({ err }, "outbox relay failed");
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** Tiny HTTP surface for the worker process: liveness, readiness and Prometheus metrics. */
export function startWorkerHttp(ctx: AppContext, port: number, host: string) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
      } else if (req.url === "/ready") {
        await ctx.pool.query("select 1");
        await ctx.storage.checkWritable();
        res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ready"}');
      } else if (req.url === "/metrics") {
        const [row] = await ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.status, "pending"));
        ctx.metrics.webhookBacklog.set(row?.n ?? 0);
        res.writeHead(200, { "content-type": ctx.metrics.registry.contentType }).end(await ctx.metrics.registry.metrics());
      } else {
        res.writeHead(404).end();
      }
    } catch (err) {
      res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ status: "unavailable", error: (err as Error).message }));
    }
  });
  server.listen(port, host);
  return server;
}
