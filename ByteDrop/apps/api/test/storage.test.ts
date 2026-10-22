import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blobs, projects } from "../src/db/schema";
import { collectGarbage } from "../src/jobs/handlers";
import { createTestEnv, sha256, type TestEnv } from "./helpers";

let env: TestEnv;
let cookie: string;
let projectId: string;

beforeAll(async () => {
  env = await createTestEnv();
  const p = await env.setupProject();
  cookie = p.cookie;
  projectId = p.project.id;
  await env.createBucket(cookie, projectId, "cas-bucket", true);
});
afterAll(async () => {
  await env.close();
});

const put = (key: string, data: Buffer) => env.upload(env.as(cookie), projectId, "cas-bucket", key, data);
const del = (key: string) =>
  env.app.inject({
    method: "DELETE",
    url: `/v1/projects/${projectId}/buckets/cas-bucket/objects?key=${encodeURIComponent(key)}`,
    headers: env.as(cookie),
  });
const blob = async (hash: string) => (await env.ctx.db.select().from(blobs).where(eq(blobs.hash, hash)))[0];

describe("content-addressed storage", () => {
  it("stores identical content once and counts references", async () => {
    const data = randomBytes(4096);
    const h = sha256(data);
    expect((await put("a/one.bin", data)).statusCode).toBe(201);
    expect((await put("b/two.bin", data)).statusCode).toBe(201);
    expect((await blob(h))?.refCount).toBe(2);
    expect(existsSync(env.ctx.storage.localPath(h))).toBe(true);

    await del("a/one.bin");
    expect((await blob(h))?.refCount).toBe(1);
    expect(existsSync(env.ctx.storage.localPath(h))).toBe(true);
  });

  it("releases the old blob when a key is overwritten with new content", async () => {
    const v1 = randomBytes(2000);
    const v2 = randomBytes(2100);
    await put("ow.bin", v1);
    await put("ow.bin", v2);
    expect((await blob(sha256(v1)))?.refCount).toBe(0);
    expect((await blob(sha256(v2)))?.refCount).toBe(1);
    const dl = await env.app.inject("/f/cas-bucket/ow.bin");
    expect(sha256(dl.rawPayload)).toBe(sha256(v2));
  });

  it("keeps the reference count when the same content is uploaded to the same key", async () => {
    const data = randomBytes(1500);
    await put("same.bin", data);
    await put("same.bin", data);
    expect((await blob(sha256(data)))?.refCount).toBe(1);
  });

  it("garbage-collects unreferenced blobs after the grace period only", async () => {
    const data = randomBytes(3000);
    const h = sha256(data);
    await put("gc.bin", data);
    await del("gc.bin");
    expect((await blob(h))?.refCount).toBe(0);

    const early = await collectGarbage(env.ctx, 60_000);
    expect(early.blobs).toBe(0);
    expect(existsSync(env.ctx.storage.localPath(h))).toBe(true);

    await new Promise((r) => setTimeout(r, 30));
    const stats = await collectGarbage(env.ctx, 0);
    expect(stats.blobs).toBeGreaterThanOrEqual(1);
    expect(await blob(h)).toBeUndefined();
    expect(existsSync(env.ctx.storage.localPath(h))).toBe(false);
  });

  it("never deletes a blob that was re-referenced before collection", async () => {
    const data = randomBytes(2500);
    const h = sha256(data);
    await put("first.bin", data);
    await del("first.bin");
    await put("second.bin", data);
    await collectGarbage(env.ctx, 0);
    expect(existsSync(env.ctx.storage.localPath(h))).toBe(true);
    const dl = await env.app.inject("/f/cas-bucket/second.bin");
    expect(dl.statusCode).toBe(200);
    expect(sha256(dl.rawPayload)).toBe(h);
  });

  it("tracks project usage through uploads, overwrites and deletes", async () => {
    const used = async () => (await env.ctx.db.select().from(projects).where(eq(projects.id, projectId)))[0]!.usedBytes;
    const start = await used();
    await put("usage.bin", randomBytes(1000));
    expect(await used()).toBe(start + 1000);
    await put("usage.bin", randomBytes(400));
    expect(await used()).toBe(start + 400);
    await del("usage.bin");
    expect(await used()).toBe(start);
  });
});
