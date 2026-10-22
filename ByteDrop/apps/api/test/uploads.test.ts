import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outbox, uploadSessions } from "../src/db/schema";
import { createTestEnv, sha256, type TestEnv } from "./helpers";

let env: TestEnv;
let cookie: string;
let projectId: string;
const CHUNK = 300_000;

beforeAll(async () => {
  env = await createTestEnv();
  const p = await env.setupProject();
  cookie = p.cookie;
  projectId = p.project.id;
  await env.createBucket(cookie, projectId, "up-bucket", true);
});
afterAll(async () => {
  await env.close();
});

const create = (body: { key: string; size: number; sha256: string; contentType?: string }) =>
  env.app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/buckets/up-bucket/uploads`,
    headers: env.as(cookie),
    payload: body,
  });

const patch = (id: string, offset: number, chunk: Buffer, chunkSha = sha256(chunk)) =>
  env.app.inject({
    method: "PATCH",
    url: `/v1/projects/${projectId}/uploads/${id}`,
    headers: { ...env.as(cookie), "content-type": "application/octet-stream", "upload-offset": String(offset), "x-chunk-sha256": chunkSha },
    payload: chunk,
  });

const status = (id: string) =>
  env.app.inject({ url: `/v1/projects/${projectId}/uploads/${id}`, headers: env.as(cookie) });

describe("resumable uploads", () => {
  it("assembles chunks, resumes after an interruption and verifies the final hash", async () => {
    const file = randomBytes(CHUNK * 3 + 12_345);
    const res = await create({ key: "big/video.mp4", size: file.length, sha256: sha256(file) });
    expect(res.statusCode).toBe(201);
    const session = res.json();
    expect(session.offset).toBe(0);
    expect(session.status).toBe("active");

    let r = await patch(session.id, 0, file.subarray(0, CHUNK));
    expect(r.statusCode).toBe(200);
    expect(r.json().offset).toBe(CHUNK);
    expect(r.headers["upload-offset"]).toBe(String(CHUNK));

    // "Connection drops": the client asks where to continue.
    const resume = await status(session.id);
    expect(resume.json().offset).toBe(CHUNK);

    r = await patch(session.id, CHUNK, file.subarray(CHUNK, CHUNK * 2));
    expect(r.json().offset).toBe(CHUNK * 2);
    r = await patch(session.id, CHUNK * 2, file.subarray(CHUNK * 2, CHUNK * 3));
    r = await patch(session.id, CHUNK * 3, file.subarray(CHUNK * 3));
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("complete");
    expect(r.json().object.sha256).toBe(sha256(file));
    expect(r.json().object.contentType).toBe("video/mp4");

    const dl = await env.app.inject("/f/up-bucket/big/video.mp4");
    expect(dl.statusCode).toBe(200);
    expect(sha256(dl.rawPayload)).toBe(sha256(file));
  });

  it("rejects a chunk sent at the wrong offset and reports the server's offset", async () => {
    const file = randomBytes(CHUNK * 2);
    const { id } = (await create({ key: "o.bin", size: file.length, sha256: sha256(file) })).json();
    await patch(id, 0, file.subarray(0, CHUNK));
    const bad = await patch(id, 0, file.subarray(0, CHUNK));
    expect(bad.statusCode).toBe(409);
    expect(bad.headers["upload-offset"]).toBe(String(CHUNK));
    expect(bad.json().error.currentOffset).toBe(CHUNK);
    const skip = await patch(id, CHUNK + 5, file.subarray(CHUNK));
    expect(skip.statusCode).toBe(409);
  });

  it("rejects a corrupted chunk without advancing the offset", async () => {
    const file = randomBytes(CHUNK * 2);
    const { id } = (await create({ key: "c.bin", size: file.length, sha256: sha256(file) })).json();
    const corrupted = Buffer.from(file.subarray(0, CHUNK));
    corrupted[10] = (corrupted[10] ?? 0) ^ 0xff;
    const bad = await patch(id, 0, corrupted, sha256(file.subarray(0, CHUNK)));
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe("chunk_hash_mismatch");
    expect((await status(id)).json().offset).toBe(0);
    const ok = await patch(id, 0, file.subarray(0, CHUNK));
    expect(ok.statusCode).toBe(200);
    expect((await env.app.inject("/metrics")).body).toMatch(/bytedrop_upload_failures_total\{reason="chunk_hash_mismatch"\} [1-9]/);
  });

  it("fails the session and emits upload.failed when the whole-file hash does not match", async () => {
    const file = randomBytes(CHUNK + 10);
    const wrong = sha256("something else");
    const { id } = (await create({ key: "h.bin", size: file.length, sha256: wrong })).json();
    await patch(id, 0, file.subarray(0, CHUNK));
    const last = await patch(id, CHUNK, file.subarray(CHUNK));
    expect(last.statusCode).toBe(422);
    expect(last.json().error.code).toBe("hash_mismatch");
    expect((await status(id)).json().status).toBe("failed");
    expect((await env.app.inject("/f/up-bucket/h.bin")).statusCode).toBe(404);

    const events = await env.ctx.db.select().from(outbox).where(eq(outbox.eventType, "upload.failed"));
    expect(events.some((e) => (e.payload as { key: string; reason: string }).key === "h.bin")).toBe(true);
  });

  it("completes instantly when identical content is already stored", async () => {
    const file = randomBytes(50_000);
    const first = (await create({ key: "dup-a.bin", size: file.length, sha256: sha256(file) })).json();
    await patch(first.id, 0, file);
    const second = await create({ key: "dup-b.bin", size: file.length, sha256: sha256(file) });
    expect(second.json().status).toBe("complete");
    expect(second.json().object.key).toBe("dup-b.bin");
  });

  it("returns 413 when the declared size exceeds the project quota", async () => {
    const tiny = await createTestEnv({ DEFAULT_QUOTA_BYTES: 1000 });
    try {
      const p = await tiny.setupProject();
      await tiny.createBucket(p.cookie, p.project.id, "tiny-bucket");
      const res = await tiny.app.inject({
        method: "POST",
        url: `/v1/projects/${p.project.id}/buckets/tiny-bucket/uploads`,
        headers: tiny.as(p.cookie),
        payload: { key: "x.bin", size: 5000, sha256: sha256("x") },
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe("quota_exceeded");
    } finally {
      await tiny.close();
    }
  });

  it("cancels a session and removes its temporary file", async () => {
    const file = randomBytes(CHUNK * 2);
    const { id } = (await create({ key: "cancel.bin", size: file.length, sha256: sha256(file) })).json();
    await patch(id, 0, file.subarray(0, CHUNK));
    const tmp = env.ctx.storage.tempPath(`upload-${id}`);
    expect(existsSync(tmp)).toBe(true);
    const del = await env.app.inject({ method: "DELETE", url: `/v1/projects/${projectId}/uploads/${id}`, headers: env.as(cookie) });
    expect(del.statusCode).toBe(204);
    expect(existsSync(tmp)).toBe(false);
    expect((await patch(id, CHUNK, file.subarray(CHUNK))).statusCode).toBe(409);
  });

  it("refuses chunks past the declared size and bad object keys", async () => {
    const file = randomBytes(100);
    const { id } = (await create({ key: "s.bin", size: 50, sha256: sha256(file) })).json();
    expect((await patch(id, 0, file)).statusCode).toBe(400);
    expect((await create({ key: "../escape", size: 1, sha256: sha256("a") })).statusCode).toBe(400);
  });

  it("expires stale sessions and records upload.failed during garbage collection", async () => {
    const file = randomBytes(CHUNK * 2);
    const { id } = (await create({ key: "stale.bin", size: file.length, sha256: sha256(file) })).json();
    await env.ctx.db.update(uploadSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(uploadSessions.id, id));
    const { collectGarbage } = await import("../src/jobs/handlers");
    const stats = await collectGarbage(env.ctx);
    expect(stats.uploads).toBeGreaterThanOrEqual(1);
    expect((await status(id)).json().status).toBe("failed");
    expect((await patch(id, 0, file.subarray(0, CHUNK))).statusCode).toBe(409);
  });
});
