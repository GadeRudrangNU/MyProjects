import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiKeys } from "../src/db/schema";
import { RateLimiter } from "../src/services/rate-limit";
import { createTestEnv, sha256, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

describe("accounts and projects", () => {
  it("requires a session to list projects and isolates users from each other", async () => {
    expect((await env.app.inject("/v1/projects")).statusCode).toBe(401);
    const a = await env.setupProject("alpha");
    const b = await env.setupProject("beta");
    const listA = await env.app.inject({ url: "/v1/projects", headers: env.as(a.cookie) });
    expect(listA.json().map((p: { name: string }) => p.name)).toEqual(["alpha"]);
    const peek = await env.app.inject({ url: `/v1/projects/${a.project.id}`, headers: env.as(b.cookie) });
    expect(peek.statusCode).toBe(404);
  });

  it("signs in with email and password and rejects a wrong password", async () => {
    const { email } = await env.signUp();
    const ok = await env.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      payload: { email, password: "correct-horse-battery" },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await env.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      payload: { email, password: "wrong-password-here" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("returns the signed-in user from /v1/me", async () => {
    const { cookie, email } = await env.signUp();
    const me = await env.app.inject({ url: "/v1/me", headers: env.as(cookie) });
    expect(me.json().email).toBe(email);
  });
});

describe("API keys", () => {
  it("stores only a hash, shows the secret once and enforces scopes", async () => {
    const { cookie, project } = await env.setupProject();
    await env.createBucket(cookie, project.id, "keys-bucket");
    const write = await env.createKey(cookie, project.id, "write");
    const read = await env.createKey(cookie, project.id, "read");
    expect(write.secret).toMatch(/^bd_live_/);

    const [row] = await env.ctx.db.select().from(apiKeys).where(eq(apiKeys.id, write.id));
    expect(row!.keyHash).toBe(sha256(write.secret));
    expect(JSON.stringify(row)).not.toContain(write.secret);

    const list = await env.app.inject({ url: `/v1/projects/${project.id}/keys`, headers: env.as(cookie) });
    expect(JSON.stringify(list.json())).not.toContain(write.secret);

    const data = randomBytes(64);
    const asRead = await env.upload(env.bearer(read.secret), project.id, "keys-bucket", "r.bin", data);
    expect(asRead.statusCode).toBe(403);
    expect(asRead.json().error.code).toBe("insufficient_scope");
    const asWrite = await env.upload(env.bearer(write.secret), project.id, "keys-bucket", "w.bin", data);
    expect(asWrite.statusCode).toBe(201);

    const listFiles = await env.app.inject({
      url: `/v1/projects/${project.id}/buckets/keys-bucket/objects`,
      headers: env.bearer(read.secret),
    });
    expect(listFiles.statusCode).toBe(200);

    // Key management needs a dashboard session.
    const mgmt = await env.app.inject({ url: `/v1/projects/${project.id}/keys`, headers: env.bearer(write.secret) });
    expect(mgmt.statusCode).toBe(403);
  });

  it("rejects revoked keys and keys used on another project", async () => {
    const a = await env.setupProject();
    const b = await env.setupProject();
    const key = await env.createKey(a.cookie, a.project.id, "write");
    const ok = await env.app.inject({ url: `/v1/projects/${a.project.id}/buckets`, headers: env.bearer(key.secret) });
    expect(ok.statusCode).toBe(200);
    const cross = await env.app.inject({ url: `/v1/projects/${b.project.id}/buckets`, headers: env.bearer(key.secret) });
    expect(cross.statusCode).toBe(403);

    const revoke = await env.app.inject({
      method: "DELETE",
      url: `/v1/projects/${a.project.id}/keys/${key.id}`,
      headers: env.as(a.cookie),
    });
    expect(revoke.json().revokedAt).not.toBeNull();
    const after = await env.app.inject({ url: `/v1/projects/${a.project.id}/buckets`, headers: env.bearer(key.secret) });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("invalid_api_key");
  });
});

describe("buckets and files", () => {
  it("creates, lists and deletes buckets; names are globally unique", async () => {
    const a = await env.setupProject();
    const b = await env.setupProject();
    await env.createBucket(a.cookie, a.project.id, "unique-name");
    const dup = await env.app.inject({
      method: "POST",
      url: `/v1/projects/${b.project.id}/buckets`,
      headers: env.as(b.cookie),
      payload: { name: "unique-name" },
    });
    expect(dup.statusCode).toBe(409);
    const invalid = await env.app.inject({
      method: "POST",
      url: `/v1/projects/${a.project.id}/buckets`,
      headers: env.as(a.cookie),
      payload: { name: "Bad Name!" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("validation_error");

    await env.upload(env.as(a.cookie), a.project.id, "unique-name", "f.txt", Buffer.from("x"), "text/plain");
    const notEmpty = await env.app.inject({
      method: "DELETE",
      url: `/v1/projects/${a.project.id}/buckets/unique-name`,
      headers: env.as(a.cookie),
    });
    expect(notEmpty.statusCode).toBe(409);
    const list = await env.app.inject({ url: `/v1/projects/${a.project.id}/buckets`, headers: env.as(a.cookie) });
    expect(list.json()[0]).toMatchObject({ name: "unique-name", objectCount: 1, totalBytes: 1 });
  });

  describe("pagination", () => {
    let cookie: string;
    let projectId: string;
    const keys = Array.from({ length: 23 }, (_, i) => `dir/file-${String(i).padStart(2, "0")}.txt`);

    beforeAll(async () => {
      const p = await env.setupProject();
      cookie = p.cookie;
      projectId = p.project.id;
      await env.createBucket(cookie, projectId, "page-bucket");
      for (const [i, k] of keys.entries()) {
        await env.upload(env.as(cookie), projectId, "page-bucket", k, Buffer.alloc((i % 5) * 10 + 1, "a"), "text/plain");
      }
      await env.upload(env.as(cookie), projectId, "page-bucket", "other/pic.png", Buffer.from("png"), "image/png");
    });

    async function walk(query: string) {
      const seen: { key: string; size: number }[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: LightMyRequestResponse = await env.app.inject({
          url: `/v1/projects/${projectId}/buckets/page-bucket/objects?limit=7&${query}${cursor ? `&cursor=${cursor}` : ""}`,
          headers: env.as(cookie),
        });
        expect(res.statusCode).toBe(200);
        const body: { items: { key: string; size: number }[]; nextCursor: string | null } = res.json();
        seen.push(...body.items);
        cursor = body.nextCursor;
        pages++;
      } while (cursor);
      return { seen, pages };
    }

    it("walks every file exactly once for each sort order", async () => {
      for (const sort of ["name", "size", "created"]) {
        for (const dir of ["asc", "desc"]) {
          const { seen, pages } = await walk(`sort=${sort}&dir=${dir}`);
          expect(seen).toHaveLength(keys.length + 1);
          expect(new Set(seen.map((s) => s.key)).size).toBe(keys.length + 1);
          expect(pages).toBe(4);
          if (sort === "name") {
            const names = seen.map((s) => s.key);
            expect(names).toEqual([...names].sort((a, b) => (dir === "asc" ? (a < b ? -1 : 1) : a < b ? 1 : -1)));
          }
          if (sort === "size") {
            const sizes = seen.map((s) => s.size);
            expect(sizes).toEqual([...sizes].sort((a, b) => (dir === "asc" ? a - b : b - a)));
          }
        }
      }
    });

    it("filters by prefix, search text and file kind", async () => {
      expect((await walk("prefix=dir/")).seen).toHaveLength(23);
      expect((await walk("q=file-1")).seen).toHaveLength(10);
      expect((await walk("kind=image")).seen.map((s) => s.key)).toEqual(["other/pic.png"]);
    });

    it("rejects malformed cursors and limits", async () => {
      const bad = await env.app.inject({
        url: `/v1/projects/${projectId}/buckets/page-bucket/objects?cursor=garbage`,
        headers: env.as(cookie),
      });
      expect(bad.statusCode).toBe(400);
      const big = await env.app.inject({
        url: `/v1/projects/${projectId}/buckets/page-bucket/objects?limit=5000`,
        headers: env.as(cookie),
      });
      expect(big.statusCode).toBe(400);
    });
  });
});

describe("quotas and rate limits", () => {
  it("returns 413 once the project quota is exceeded and releases space on delete", async () => {
    const q = await createTestEnv({ DEFAULT_QUOTA_BYTES: 3000 });
    try {
      const p = await q.setupProject();
      await q.createBucket(p.cookie, p.project.id, "quota-bucket");
      const up = (key: string, n: number) => q.upload(q.as(p.cookie), p.project.id, "quota-bucket", key, randomBytes(n));
      expect((await up("a", 2000)).statusCode).toBe(201);
      const over = await up("b", 1500);
      expect(over.statusCode).toBe(413);
      expect(over.json().error.code).toBe("quota_exceeded");
      await q.app.inject({
        method: "DELETE",
        url: `/v1/projects/${p.project.id}/buckets/quota-bucket/objects?key=a`,
        headers: q.as(p.cookie),
      });
      expect((await up("b", 1500)).statusCode).toBe(201);
    } finally {
      await q.close();
    }
  });

  it("returns 429 with Retry-After once a key exceeds its rate limit", async () => {
    const r = await createTestEnv({ RATE_LIMIT_PER_MIN: 5 });
    try {
      const p = await r.setupProject();
      const key = await r.createKey(p.cookie, p.project.id, "read");
      const hit = () => r.app.inject({ url: `/v1/projects/${p.project.id}/buckets`, headers: r.bearer(key.secret) });
      const codes: number[] = [];
      for (let i = 0; i < 8; i++) codes.push((await hit()).statusCode);
      expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(5);
      const limited = await hit();
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(limited.json().error.code).toBe("rate_limited");
    } finally {
      await r.close();
    }
  });

  it("refills tokens over time (unit)", () => {
    let t = 0;
    const limiter = new RateLimiter(60, () => t);
    for (let i = 0; i < 60; i++) expect(limiter.take("k").ok).toBe(true);
    const blocked = limiter.take("k");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
    t += 1000;
    expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("other").ok).toBe(true);
  });
});

describe("API documentation", () => {
  it("serves an OpenAPI document generated from the Zod schemas, plus interactive docs", async () => {
    const doc = (await env.app.inject("/docs/openapi.json")).json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/v1/projects/{projectId}/buckets",
        "/v1/projects/{projectId}/uploads/{uploadId}",
        "/v1/projects/{projectId}/analytics",
        "/f/{bucket}/{*}",
      ]),
    );
    const createBucket = doc.paths["/v1/projects/{projectId}/buckets"].post;
    expect(JSON.stringify(createBucket.requestBody)).toContain("isPublic");
    expect((await env.app.inject("/docs/")).statusCode).toBe(200);
  });
});
