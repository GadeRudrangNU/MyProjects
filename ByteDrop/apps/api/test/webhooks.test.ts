import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outbox, webhookDeliveries } from "../src/db/schema";
import { backoffMs } from "../src/services/webhooks";
import { createTestEnv, sha256, waitFor, type TestEnv } from "./helpers";
import { startReceiver } from "./receiver";

let env: TestEnv;
let cookie: string;
let projectId: string;
let n = 0;

beforeAll(async () => {
  env = await createTestEnv({ WEBHOOK_MAX_ATTEMPTS: 4, WEBHOOK_BREAKER_THRESHOLD: 3 }, { worker: true });
  const p = await env.setupProject();
  cookie = p.cookie;
  projectId = p.project.id;
  await env.createBucket(cookie, projectId, "hook-bucket", true);
});
afterAll(async () => {
  await env.close();
});

async function addEndpoint(url: string, events?: string[]) {
  const res = await env.app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/webhooks`,
    headers: env.as(cookie),
    payload: { url, ...(events ? { events } : {}) },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; secret: string };
}

const removeEndpoint = (id: string) =>
  env.app.inject({ method: "DELETE", url: `/v1/projects/${projectId}/webhooks/${id}`, headers: env.as(cookie) });

const upload = (key: string, data = randomBytes(32)) =>
  env.upload(env.as(cookie), projectId, "hook-bucket", key, data, "application/octet-stream");

const deliveryRows = (endpointId: string) =>
  env.ctx.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpointId));

const uniqueKey = (p: string) => `${p}-${++n}.bin`;

describe("webhook delivery", () => {
  it("sends a signed object.created event and records the delivery", async () => {
    const rx = await startReceiver();
    const ep = await addEndpoint(rx.url);
    const key = uniqueKey("created");
    await upload(key);

    await waitFor(async () => rx.hits.length > 0);
    const hit = rx.hits[0]!;
    expect(hit.json.type).toBe("object.created");
    expect((hit.json.data as { object: { key: string } }).object.key).toBe(key);
    expect(hit.headers["bytedrop-event"]).toBe("object.created");

    const sig = String(hit.headers["bytedrop-signature"]);
    const t = /t=(\d+)/.exec(sig)![1]!;
    const v1 = /v1=([a-f0-9]+)/.exec(sig)![1]!;
    expect(v1).toBe(createHmac("sha256", ep.secret).update(`${t}.${hit.body}`).digest("hex"));

    const row = await waitFor(async () => (await deliveryRows(ep.id)).find((r) => r.status === "success"));
    expect(row.attempts).toBe(1);
    expect(row.lastStatusCode).toBe(200);
    expect(row.lastResponseMs).toBeGreaterThanOrEqual(0);
    await rx.close();
    await removeEndpoint(ep.id);
  });

  it("sends object.deleted and honours the endpoint's event filter", async () => {
    const all = await startReceiver();
    const onlyDeleted = await startReceiver();
    const a = await addEndpoint(all.url);
    const b = await addEndpoint(onlyDeleted.url, ["object.deleted"]);
    const key = uniqueKey("del");
    await upload(key);
    await env.app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/buckets/hook-bucket/objects?key=${encodeURIComponent(key)}`,
      headers: env.as(cookie),
    });
    await waitFor(async () => all.hits.length >= 2 && onlyDeleted.hits.length >= 1);
    expect(all.hits.map((h) => h.json.type).sort()).toEqual(["object.created", "object.deleted"]);
    expect(onlyDeleted.hits.map((h) => h.json.type)).toEqual(["object.deleted"]);
    await Promise.all([all.close(), onlyDeleted.close(), removeEndpoint(a.id), removeEndpoint(b.id)]);
  });

  it("retries failed deliveries with growing delays until they succeed", async () => {
    const rx = await startReceiver();
    rx.failFirst(2);
    const ep = await addEndpoint(rx.url, ["object.created"]);
    await upload(uniqueKey("retry"));
    await waitFor(async () => rx.hits.length >= 3);
    const row = await waitFor(async () => (await deliveryRows(ep.id)).find((r) => r.status === "success"));
    expect(row.attempts).toBe(3);
    const gaps = rx.hits.slice(1).map((h, i) => h.at - rx.hits[i]!.at);
    expect(gaps[1]!).toBeGreaterThan(gaps[0]! * 0.9);
    await rx.close();
    await removeEndpoint(ep.id);
  });

  it("marks a delivery failed after the last attempt, then replays it once the receiver recovers", async () => {
    const rx = await startReceiver("fail");
    const ep = await addEndpoint(rx.url, ["object.created"]);
    await upload(uniqueKey("fail"));

    const failed = await waitFor(async () => (await deliveryRows(ep.id)).find((r) => r.status === "failed"), 15_000);
    expect(failed.attempts).toBe(4);
    expect(failed.lastStatusCode).toBe(500);
    expect(failed.lastError).toContain("500");

    const log = await env.app.inject({
      url: `/v1/projects/${projectId}/webhooks/deliveries?status=failed`,
      headers: env.as(cookie),
    });
    expect(log.json().items.some((d: { id: string }) => d.id === failed.id)).toBe(true);

    rx.set("ok");
    const replay = await env.app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/webhooks/deliveries/${failed.id}/replay`,
      headers: env.as(cookie),
    });
    expect(replay.statusCode).toBe(200);
    const after = await waitFor(async () => (await deliveryRows(ep.id)).find((r) => r.id === failed.id && r.status === "success"));
    expect(after.attempts).toBe(1);
    await rx.close();
    await removeEndpoint(ep.id);
  });

  it("times out a receiver that never answers", async () => {
    const rx = await startReceiver("hang");
    const ep = await addEndpoint(rx.url, ["object.created"]);
    await upload(uniqueKey("hang"));
    const row = await waitFor(async () => (await deliveryRows(ep.id)).find((r) => r.attempts >= 1));
    expect(row.lastError).toContain("timed out");
    expect(row.lastResponseMs).toBeGreaterThanOrEqual(700);
    await rx.close();
    await removeEndpoint(ep.id);
  });

  it("opens a circuit after repeated failures so a dead receiver stops being hammered", async () => {
    const rx = await startReceiver("fail");
    const ep = await addEndpoint(rx.url, ["object.created"]);
    for (let i = 0; i < 4; i++) await upload(uniqueKey("breaker"));
    await waitFor(async () => (await deliveryRows(ep.id)).every((r) => r.status === "failed"), 20_000);
    const rows = await deliveryRows(ep.id);
    const attempts = rows.reduce((a, r) => a + r.attempts, 0);
    expect(rx.hits.length).toBe(attempts);
    expect(rx.hits.length).toBeLessThan(4 * 4 + 1);
    expect(rows.some((r) => r.lastError?.includes("circuit open") || r.lastError?.includes("500"))).toBe(true);
    await rx.close();
    await removeEndpoint(ep.id);
  });

  it("emits upload.failed when an upload's hash does not match", async () => {
    const rx = await startReceiver();
    const ep = await addEndpoint(rx.url, ["upload.failed"]);
    const data = randomBytes(100);
    const created = await env.app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/buckets/hook-bucket/uploads`,
      headers: env.as(cookie),
      payload: { key: "bad-hash.bin", size: data.length, sha256: sha256("not it") },
    });
    const res = await env.app.inject({
      method: "PATCH",
      url: `/v1/projects/${projectId}/uploads/${created.json().id}`,
      headers: { ...env.as(cookie), "content-type": "application/octet-stream", "upload-offset": "0", "x-chunk-sha256": sha256(data) },
      payload: data,
    });
    expect(res.statusCode).toBe(422);
    await waitFor(async () => rx.hits.length > 0);
    expect(rx.hits[0]!.json.type).toBe("upload.failed");
    expect((rx.hits[0]!.json.data as { reason: string }).reason).toBe("hash_mismatch");
    await rx.close();
    await removeEndpoint(ep.id);
  });

  it("writes the outbox row in the same transaction as the change (nothing is queued when the change is rejected)", async () => {
    const q = await createTestEnv({ DEFAULT_QUOTA_BYTES: 500 });
    try {
      const p = await q.setupProject();
      await q.createBucket(p.cookie, p.project.id, "tx-bucket");
      const before = (await q.ctx.db.select().from(outbox)).length;
      const rejected = await q.upload(q.as(p.cookie), p.project.id, "tx-bucket", "big.bin", randomBytes(2000));
      expect(rejected.statusCode).toBe(413);
      expect((await q.ctx.db.select().from(outbox)).length).toBe(before);
      const ok = await q.upload(q.as(p.cookie), p.project.id, "tx-bucket", "small.bin", randomBytes(100));
      expect(ok.statusCode).toBe(201);
      expect((await q.ctx.db.select().from(outbox)).length).toBe(before + 1);
    } finally {
      await q.close();
    }
  });

  it("lists deliveries newest-first with cursor pagination", async () => {
    const rx = await startReceiver();
    const ep = await addEndpoint(rx.url, ["object.created"]);
    for (let i = 0; i < 5; i++) await upload(uniqueKey("page"));
    await waitFor(async () => (await deliveryRows(ep.id)).filter((r) => r.status === "success").length === 5);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: LightMyRequestResponse = await env.app.inject({
        url: `/v1/projects/${projectId}/webhooks/deliveries?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
        headers: env.as(cookie),
      });
      const body: { items: { id: string }[]; nextCursor: string | null } = res.json();
      seen.push(...body.items.map((d) => d.id));
      cursor = body.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    const mine = (await deliveryRows(ep.id)).map((r) => r.id);
    expect(mine.every((id) => seen.includes(id))).toBe(true);
    await rx.close();
    await removeEndpoint(ep.id);
  });

  it("computes exponential backoff with jitter (unit)", () => {
    const mid = () => 0.5;
    expect(backoffMs(1, 1000, mid)).toBe(1000);
    expect(backoffMs(2, 1000, mid)).toBe(2000);
    expect(backoffMs(5, 1000, mid)).toBe(16000);
    expect(backoffMs(30, 1000, mid)).toBe(3_600_000);
  });
});
