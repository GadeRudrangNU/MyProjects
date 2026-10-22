import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { WebhookDelivery } from "@bytedrop/shared";
import type { AppContext } from "../context";
import { outbox, webhookDeliveries, webhookEndpoints } from "../db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { Q } from "../jobs/queues";
import { hmacHex } from "../util";

export function backoffMs(attempt: number, baseMs: number, rand = Math.random) {
  const raw = Math.min(baseMs * 2 ** (attempt - 1), 60 * 60 * 1000);
  return Math.round(raw * (0.75 + rand() * 0.5));
}

export function signPayload(secret: string, timestamp: number, body: string) {
  return `t=${timestamp},v1=${hmacHex(secret, `${timestamp}.${body}`)}`;
}

export function toDelivery(row: typeof webhookDeliveries.$inferSelect): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventType: row.eventType as WebhookDelivery["eventType"],
    status: row.status,
    attempts: row.attempts,
    lastStatusCode: row.lastStatusCode,
    lastResponseMs: row.lastResponseMs,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    payload: row.payload,
  };
}

/**
 * Outbox relay: turns committed outbox rows into per-endpoint deliveries and enqueues one job per
 * delivery, all in a single transaction so a crash cannot lose or duplicate work.
 */
export async function dispatchOutbox(ctx: AppContext, batch = 100): Promise<number> {
  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    const tx = drizzle(client, { schema });
    const pending = await tx
      .select()
      .from(outbox)
      .where(sql`${outbox.dispatchedAt} is null`)
      .orderBy(outbox.id)
      .limit(batch)
      .for("update", { skipLocked: true });

    for (const event of pending) {
      const endpoints = await tx
        .select()
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.projectId, event.projectId),
            eq(webhookEndpoints.active, true),
            sql`${event.eventType} = any(${webhookEndpoints.events})`,
          ),
        );
      for (const ep of endpoints) {
        const [delivery] = await tx
          .insert(webhookDeliveries)
          .values({
            projectId: event.projectId,
            endpointId: ep.id,
            outboxId: event.id,
            eventType: event.eventType,
            payload: event.payload,
            nextAttemptAt: new Date(),
            trace: event.trace,
          })
          .returning({ id: webhookDeliveries.id });
        await ctx.jobs.send(
          Q.webhook,
          { deliveryId: delivery!.id, _trace: event.trace ?? undefined },
          { db: { executeSql: (text, values) => client.query(text, values as unknown[]) } },
        );
      }
      await tx.update(outbox).set({ dispatchedAt: new Date() }).where(eq(outbox.id, event.id));
    }
    await client.query("commit");
    return pending.length;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

interface BreakerState {
  failures: number;
  openUntil: number;
}

export class WebhookSender {
  private readonly breakers = new Map<string, BreakerState>();

  constructor(private readonly ctx: AppContext) {}

  async attempt(deliveryId: string): Promise<void> {
    const { db, cfg, metrics, jobs } = this.ctx;
    const [row] = await db
      .select({ d: webhookDeliveries, e: webhookEndpoints })
      .from(webhookDeliveries)
      .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
      .where(eq(webhookDeliveries.id, deliveryId));
    if (!row || row.d.status !== "pending") return;
    const { d, e } = row;

    if (!e.active) {
      await db
        .update(webhookDeliveries)
        .set({ status: "failed", lastError: "endpoint disabled", nextAttemptAt: null, updatedAt: new Date() })
        .where(eq(webhookDeliveries.id, d.id));
      return;
    }

    const breaker = this.breakers.get(e.id);
    if (cfg.WEBHOOK_BREAKER === "on" && breaker && breaker.openUntil > Date.now()) {
      const next = new Date(breaker.openUntil);
      await db
        .update(webhookDeliveries)
        .set({ nextAttemptAt: next, lastError: "circuit open: receiver is failing", updatedAt: new Date() })
        .where(eq(webhookDeliveries.id, d.id));
      await jobs.send(Q.webhook, { deliveryId: d.id, _trace: d.trace ?? undefined }, { startAfter: next });
      return;
    }

    const body = JSON.stringify({
      id: d.id,
      type: d.eventType,
      createdAt: d.createdAt.toISOString(),
      data: d.payload,
    });
    const ts = Math.floor(Date.now() / 1000);
    const started = performance.now();
    let status: number | null = null;
    let error: string | null = null;
    let outcome: "success" | "http_error" | "timeout" | "network_error" = "success";
    try {
      const res = await fetch(e.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(cfg.WEBHOOK_TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          "user-agent": "ByteDrop-Webhooks/1",
          "bytedrop-signature": signPayload(e.secret, ts, body),
          "bytedrop-event": d.eventType,
          "bytedrop-delivery": d.id,
        },
        body,
      });
      status = res.status;
      await res.body?.cancel().catch(() => {});
      if (status < 200 || status >= 300) {
        outcome = "http_error";
        error = `receiver responded ${status}`;
      }
    } catch (err) {
      const name = (err as Error).name;
      outcome = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error";
      error = outcome === "timeout" ? `timed out after ${cfg.WEBHOOK_TIMEOUT_MS}ms` : (err as Error).message;
    }
    const ms = Math.round(performance.now() - started);
    metrics.webhookAttempts.inc({ outcome });
    metrics.webhookAttemptDuration.observe(ms / 1000);

    const attempts = d.attempts + 1;
    const ok = outcome === "success";
    const exhausted = !ok && attempts >= cfg.WEBHOOK_MAX_ATTEMPTS;
    const next = !ok && !exhausted ? new Date(Date.now() + backoffMs(attempts, cfg.WEBHOOK_BACKOFF_MS)) : null;

    if (ok) this.breakers.delete(e.id);
    else {
      const b = this.breakers.get(e.id) ?? { failures: 0, openUntil: 0 };
      b.failures++;
      if (b.failures >= cfg.WEBHOOK_BREAKER_THRESHOLD) {
        b.openUntil = Date.now() + cfg.WEBHOOK_BREAKER_COOLDOWN_MS;
        b.failures = 0;
      }
      this.breakers.set(e.id, b);
    }

    await db
      .update(webhookDeliveries)
      .set({
        attempts,
        status: ok ? "success" : exhausted ? "failed" : "pending",
        lastStatusCode: status,
        lastResponseMs: ms,
        lastError: error,
        nextAttemptAt: next,
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, d.id));
    if (next) await jobs.send(Q.webhook, { deliveryId: d.id, _trace: d.trace ?? undefined }, { startAfter: next });
  }
}

export async function replayDelivery(ctx: AppContext, projectId: string, id: string) {
  const [row] = await ctx.db
    .update(webhookDeliveries)
    .set({ status: "pending", attempts: 0, lastError: null, nextAttemptAt: new Date(), updatedAt: new Date() })
    .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.projectId, projectId)))
    .returning();
  if (row) await ctx.jobs.send(Q.webhook, { deliveryId: row.id, _trace: row.trace ?? undefined });
  return row ?? null;
}

export async function listDeliveries(
  ctx: AppContext,
  projectId: string,
  q: { cursor?: string; limit: number; status?: "pending" | "success" | "failed" },
  decode: (c: string) => [string, string],
  encode: (parts: unknown[]) => string,
) {
  const conds = [eq(webhookDeliveries.projectId, projectId)];
  if (q.status) conds.push(eq(webhookDeliveries.status, q.status));
  if (q.cursor) {
    const [ts, id] = decode(q.cursor);
    const t = new Date(ts);
    conds.push(or(lt(webhookDeliveries.createdAt, t), and(eq(webhookDeliveries.createdAt, t), lt(webhookDeliveries.id, id)))!);
  }
  const rows = await ctx.db
    .select()
    .from(webhookDeliveries)
    .where(and(...conds))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toDelivery),
    nextCursor: rows.length > q.limit && last ? encode([last.createdAt.toISOString(), last.id]) : null,
  };
}
