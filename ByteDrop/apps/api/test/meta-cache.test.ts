import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MetaCache } from "../src/services/meta-cache";
import { createTestEnv, sha256, type TestEnv } from "./helpers";

describe("MetaCache", () => {
  it("serves repeat lookups from memory until the ttl passes", async () => {
    let t = 0;
    let loads = 0;
    const cache = new MetaCache<number>(1000, 100, () => t);
    const load = async () => ++loads;
    expect(await cache.lookup("b", "k", load)).toBe(1);
    expect(await cache.lookup("b", "k", load)).toBe(1);
    t = 999;
    expect(await cache.lookup("b", "k", load)).toBe(1);
    t = 1001;
    expect(await cache.lookup("b", "k", load)).toBe(2);
    expect(cache.hits).toBe(2);
  });

  it("collapses concurrent lookups into one load", async () => {
    let loads = 0;
    const cache = new MetaCache<number>(1000);
    const load = async () => {
      loads++;
      await new Promise((r) => setTimeout(r, 20));
      return 7;
    };
    const results = await Promise.all(Array.from({ length: 50 }, () => cache.lookup("b", "k", load)));
    expect(results.every((r) => r === 7)).toBe(true);
    expect(loads).toBe(1);
    expect(cache.collapsed).toBe(49);
  });

  it("does not let a lookup that started before a write repopulate the cache", async () => {
    let value = "old";
    const cache = new MetaCache<string>(1000);
    const slowLoad = async () => {
      const seen = value;
      await new Promise((r) => setTimeout(r, 30));
      return seen;
    };
    const pending = cache.lookup("b", "k", slowLoad);
    value = "new";
    cache.invalidate("b", "k");
    expect(await pending).toBe("old");
    expect(await cache.lookup("b", "k", async () => value)).toBe("new");
  });

  it("invalidates a whole bucket and respects the size bound", async () => {
    const cache = new MetaCache<number>(1000, 2);
    await cache.lookup("b", "1", async () => 1);
    await cache.lookup("b", "2", async () => 2);
    await cache.lookup("c", "3", async () => 3);
    let loads = 0;
    await cache.lookup("b", "2", async () => ++loads);
    cache.invalidateBucket("c");
    await cache.lookup("c", "3", async () => ++loads);
    // "b/2" is still cached; "b/1" was evicted by the size bound and "c/3" by the bucket invalidation.
    expect(loads).toBe(1);
    await cache.lookup("b", "1", async () => ++loads);
    expect(loads).toBe(2);
  });

  it("is disabled with a zero ttl", async () => {
    let loads = 0;
    const cache = new MetaCache<number>(0);
    await cache.lookup("b", "k", async () => ++loads);
    await cache.lookup("b", "k", async () => ++loads);
    expect(loads).toBe(2);
  });
});

describe("delivery metadata cache", () => {
  let env: TestEnv;
  let cookie: string;
  let projectId: string;

  beforeAll(async () => {
    env = await createTestEnv({ DELIVERY_META_TTL_MS: 60_000 });
    const p = await env.setupProject();
    cookie = p.cookie;
    projectId = p.project.id;
    await env.createBucket(cookie, projectId, "meta-bucket", true);
  });
  afterAll(async () => {
    await env.close();
  });

  it("shows overwrites, deletes and new files immediately even with a long ttl", async () => {
    const v1 = randomBytes(300);
    const v2 = randomBytes(310);
    expect((await env.app.inject("/f/meta-bucket/a.bin")).statusCode).toBe(404);

    await env.upload(env.as(cookie), projectId, "meta-bucket", "a.bin", v1);
    const first = await env.app.inject("/f/meta-bucket/a.bin");
    expect(first.statusCode).toBe(200);
    expect(sha256(first.rawPayload)).toBe(sha256(v1));
    await env.app.inject("/f/meta-bucket/a.bin");
    expect(env.ctx.deliveryMeta.hits).toBeGreaterThan(0);

    await env.upload(env.as(cookie), projectId, "meta-bucket", "a.bin", v2);
    const second = await env.app.inject("/f/meta-bucket/a.bin");
    expect(sha256(second.rawPayload)).toBe(sha256(v2));
    expect(second.headers.etag).not.toBe(first.headers.etag);

    await env.app.inject({
      method: "DELETE",
      url: `/v1/projects/${projectId}/buckets/meta-bucket/objects?key=a.bin`,
      headers: env.as(cookie),
    });
    expect((await env.app.inject("/f/meta-bucket/a.bin")).statusCode).toBe(404);
  });

  it("does not skip authorization for cached private files", async () => {
    await env.createBucket(cookie, projectId, "meta-private", false);
    await env.upload(env.as(cookie), projectId, "meta-private", "s.bin", randomBytes(50));
    const key = await env.createKey(cookie, projectId, "read");
    expect((await env.app.inject({ url: "/f/meta-private/s.bin", headers: env.bearer(key.secret) })).statusCode).toBe(200);
    expect((await env.app.inject("/f/meta-private/s.bin")).statusCode).toBe(401);
    expect((await env.app.inject({ url: "/f/meta-private/s.bin", headers: env.bearer(key.secret) })).statusCode).toBe(200);
  });
});

describe("HotFileCache", () => {
  it("keeps small files in memory, evicts least recently used within its byte budget and skips big files", async () => {
    const { HotFileCache } = await import("../src/services/hot-cache");
    const cache = new HotFileCache(100, 60);
    let loads = 0;
    const load = (n: number) => async () => (loads++, Buffer.alloc(n, 1));
    await cache.get("a", load(40));
    await cache.get("b", load(40));
    await cache.get("a", load(40)); // refresh a
    await cache.get("c", load(40)); // evicts b
    expect(cache.size).toBe(80);
    await cache.get("a", load(40));
    expect(loads).toBe(3);
    await cache.get("b", load(40));
    expect(loads).toBe(4);
    await cache.get("big", load(61));
    await cache.get("big", load(61));
    expect(loads).toBe(6);
    expect(new HotFileCache(0).enabled).toBe(false);
  });

  it("shares one read between concurrent requests", async () => {
    const { HotFileCache } = await import("../src/services/hot-cache");
    const cache = new HotFileCache(1000);
    let loads = 0;
    const slow = async () => {
      loads++;
      await new Promise((r) => setTimeout(r, 15));
      return Buffer.from("x");
    };
    await Promise.all(Array.from({ length: 20 }, () => cache.get("k", slow)));
    expect(loads).toBe(1);
  });
});
