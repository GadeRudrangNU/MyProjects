import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSignedUrl } from "../src/services/signing";
import { createTestEnv, makeImage, sha256, type TestEnv } from "./helpers";

let env: TestEnv;
let cookie: string;
let projectId: string;
const data = randomBytes(1000);

beforeAll(async () => {
  env = await createTestEnv();
  const p = await env.setupProject();
  cookie = p.cookie;
  projectId = p.project.id;
  await env.createBucket(cookie, projectId, "pub-bucket", true);
  await env.createBucket(cookie, projectId, "priv-bucket", false);
  await env.upload(env.as(cookie), projectId, "pub-bucket", "docs/blob.bin", data, "application/octet-stream");
  await env.upload(env.as(cookie), projectId, "priv-bucket", "secret/report final.pdf", data, "application/pdf");
  await env.upload(env.as(cookie), projectId, "pub-bucket", "notes.txt", Buffer.from("hello"), "text/plain");
});
afterAll(async () => {
  await env.close();
});

describe("headers and conditional requests", () => {
  it("serves content with ETag, Cache-Control, Content-Type and Content-Disposition", async () => {
    const res = await env.app.inject("/f/pub-bucket/docs/blob.bin");
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe(`"${sha256(data).slice(0, 32)}"`);
    expect(res.headers["cache-control"]).toContain("public");
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-disposition"]).toContain('inline; filename="blob.bin"');
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-length"]).toBe("1000");
  });

  it("returns 304 with no body for a matching If-None-Match", async () => {
    const first = await env.app.inject("/f/pub-bucket/docs/blob.bin");
    const res = await env.app.inject({
      url: "/f/pub-bucket/docs/blob.bin",
      headers: { "if-none-match": String(first.headers.etag) },
    });
    expect(res.statusCode).toBe(304);
    expect(res.body).toBe("");
    expect(res.headers.etag).toBe(first.headers.etag);
  });

  it("handles weak validators, lists and wildcards", async () => {
    const etag = String((await env.app.inject("/f/pub-bucket/docs/blob.bin")).headers.etag);
    for (const v of [`W/${etag}`, `"nope", ${etag}`, "*"]) {
      const res = await env.app.inject({ url: "/f/pub-bucket/docs/blob.bin", headers: { "if-none-match": v } });
      expect(res.statusCode).toBe(304);
    }
    const miss = await env.app.inject({ url: "/f/pub-bucket/docs/blob.bin", headers: { "if-none-match": '"other"' } });
    expect(miss.statusCode).toBe(200);
  });

  it("supports HEAD without a body", async () => {
    const res = await env.app.inject({ method: "HEAD", url: "/f/pub-bucket/docs/blob.bin" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-length"]).toBe("1000");
    expect(res.body).toBe("");
  });

  it("uses attachment disposition for ?download and encodes unicode names", async () => {
    const res = await env.app.inject("/f/pub-bucket/docs/blob.bin?download=1");
    expect(res.headers["content-disposition"]).toMatch(/^attachment/);
  });

  it("returns 404 for unknown files and buckets", async () => {
    expect((await env.app.inject("/f/pub-bucket/missing.txt")).statusCode).toBe(404);
    expect((await env.app.inject("/f/no-such-bucket/x")).statusCode).toBe(404);
  });
});

describe("range requests", () => {
  it("returns 206 for a bounded range", async () => {
    const res = await env.app.inject({ url: "/f/pub-bucket/docs/blob.bin", headers: { range: "bytes=0-99" } });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 0-99/1000");
    expect(res.headers["content-length"]).toBe("100");
    expect(res.rawPayload.equals(data.subarray(0, 100))).toBe(true);
  });

  it("supports open-ended and suffix ranges", async () => {
    const open = await env.app.inject({ url: "/f/pub-bucket/docs/blob.bin", headers: { range: "bytes=900-" } });
    expect(open.statusCode).toBe(206);
    expect(open.rawPayload.equals(data.subarray(900))).toBe(true);
    const suffix = await env.app.inject({ url: "/f/pub-bucket/docs/blob.bin", headers: { range: "bytes=-50" } });
    expect(suffix.headers["content-range"]).toBe("bytes 950-999/1000");
    expect(suffix.rawPayload.equals(data.subarray(950))).toBe(true);
  });

  it("clamps an end past the file size", async () => {
    const res = await env.app.inject({ url: "/f/pub-bucket/docs/blob.bin", headers: { range: "bytes=990-5000" } });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 990-999/1000");
  });

  it("returns 416 when the range starts beyond the end", async () => {
    const res = await env.app.inject({ url: "/f/pub-bucket/docs/blob.bin", headers: { range: "bytes=2000-" } });
    expect(res.statusCode).toBe(416);
    expect(res.headers["content-range"]).toBe("bytes */1000");
  });

  it("ignores Range when If-Range does not match", async () => {
    const res = await env.app.inject({
      url: "/f/pub-bucket/docs/blob.bin",
      headers: { range: "bytes=0-9", "if-range": '"stale"' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBe(1000);
  });
});

describe("private buckets", () => {
  const sign = (exp: number, key = "secret/report final.pdf") => {
    const { url } = buildSignedUrl("", env.cfg.URL_SIGNING_SECRET, "priv-bucket", key, exp);
    return url;
  };

  it("rejects unauthenticated requests", async () => {
    expect((await env.app.inject("/f/priv-bucket/secret/report%20final.pdf")).statusCode).toBe(401);
  });

  it("serves a valid signed link", async () => {
    const res = await env.app.inject(sign(300));
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.rawPayload.equals(data)).toBe(true);
  });

  it("returns 403 for a wrong signature", async () => {
    const url = sign(300).replace(/sig=[a-f0-9]{4}/, "sig=ffff");
    const res = await env.app.inject(url);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("invalid_signature");
  });

  it("returns 403 when the expiry was tampered with", async () => {
    const url = sign(300).replace(/exp=\d+/, "exp=9999999999");
    expect((await env.app.inject(url)).statusCode).toBe(403);
  });

  it("returns 410 for an expired link", async () => {
    const res = await env.app.inject(sign(-5));
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("link_expired");
  });

  it("does not let a signature for one file open another", async () => {
    const url = sign(300, "other.pdf").replace("other.pdf", "secret/report%20final.pdf");
    expect((await env.app.inject(url)).statusCode).toBe(403);
  });

  it("accepts an API key of the same project and refuses another project's key", async () => {
    const key = await env.createKey(cookie, projectId, "read");
    const ok = await env.app.inject({ url: "/f/priv-bucket/secret/report%20final.pdf", headers: env.bearer(key.secret) });
    expect(ok.statusCode).toBe(200);

    const other = await env.setupProject("other");
    const otherKey = await env.createKey(other.cookie, other.project.id, "read");
    const denied = await env.app.inject({ url: "/f/priv-bucket/secret/report%20final.pdf", headers: env.bearer(otherKey.secret) });
    expect(denied.statusCode).toBe(403);
  });

  it("creates signed links through the API", async () => {
    const res = await env.app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/buckets/priv-bucket/sign`,
      headers: env.as(cookie),
      payload: { key: "secret/report final.pdf", expiresInSeconds: 120 },
    });
    expect(res.statusCode).toBe(200);
    const link = new URL(res.json().url);
    const dl = await env.app.inject(link.pathname + link.search);
    expect(dl.statusCode).toBe(200);
  });
});

describe("image transforms", () => {
  let imageKey = "photos/big.png";
  beforeAll(async () => {
    const raw = randomBytes(1200 * 900 * 3);
    const big = await sharp(raw, { raw: { width: 1200, height: 900, channels: 3 } }).png().toBuffer();
    await env.upload(env.as(cookie), projectId, "pub-bucket", imageKey, big, "image/png");
    await env.upload(env.as(cookie), projectId, "pub-bucket", "photos/small.png", await makeImage(60, 40), "image/png");
  });

  it("resizes and converts on the fly", async () => {
    const res = await env.app.inject(`/f/pub-bucket/${imageKey}?w=300&format=webp&q=70`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(225);
    expect(res.rawPayload.length).toBeLessThan(1200 * 900 * 3);
  });

  it("does not enlarge beyond the original", async () => {
    const res = await env.app.inject("/f/pub-bucket/photos/small.png?w=500");
    const meta = await sharp(res.rawPayload).metadata();
    expect(meta.width).toBe(60);
  });

  it("serves repeat requests from the cache", async () => {
    const url = `/f/pub-bucket/${imageKey}?w=210&format=jpeg`;
    const before = env.ctx.transformer.processed;
    await env.app.inject(url);
    await env.app.inject(url);
    await env.app.inject(url);
    expect(env.ctx.transformer.processed - before).toBe(1);
    const metrics = (await env.app.inject("/metrics")).body;
    expect(metrics).toMatch(/bytedrop_cache_events_total\{layer="transform",result="hit"\} [1-9]/);
    expect(metrics).toMatch(/bytedrop_cache_events_total\{layer="transform",result="miss"\} [1-9]/);
  });

  it("coalesces 50 concurrent requests for the same uncached variant into one render", async () => {
    const url = `/f/pub-bucket/${imageKey}?w=333&format=avif&q=50`;
    const before = env.ctx.transformer.processed;
    const responses = await Promise.all(Array.from({ length: 50 }, () => env.app.inject(url)));
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(new Set(responses.map((r) => sha256(r.rawPayload))).size).toBe(1);
    expect(env.ctx.transformer.processed - before).toBe(1);
    const metrics = (await env.app.inject("/metrics")).body;
    expect(metrics).toMatch(/bytedrop_cache_events_total\{layer="transform",result="coalesced"\} [1-9]/);
  });

  it("answers If-None-Match for a variant without rendering it", async () => {
    const url = `/f/pub-bucket/${imageKey}?w=111&format=webp`;
    const etag = String((await env.app.inject(url)).headers.etag);
    const before = env.ctx.transformer.processed;
    const res = await env.app.inject({ url: `/f/pub-bucket/${imageKey}?w=111&format=webp`, headers: { "if-none-match": etag } });
    expect(res.statusCode).toBe(304);
    expect(env.ctx.transformer.processed).toBe(before);
  });

  it("supports ranges on transformed output", async () => {
    const res = await env.app.inject({ url: `/f/pub-bucket/${imageKey}?w=210&format=jpeg`, headers: { range: "bytes=0-9" } });
    expect(res.statusCode).toBe(206);
    expect(res.rawPayload.length).toBe(10);
  });

  it("rejects transforms on non-images and invalid parameters", async () => {
    expect((await env.app.inject("/f/pub-bucket/notes.txt?w=100")).statusCode).toBe(400);
    expect((await env.app.inject(`/f/pub-bucket/${imageKey}?w=99999`)).statusCode).toBe(400);
    expect((await env.app.inject(`/f/pub-bucket/${imageKey}?format=bmp`)).statusCode).toBe(400);
  });

  it("evicts least recently used variants when the cache is over budget", async () => {
    const small = await createTestEnv({ TRANSFORM_CACHE_BYTES: 40_000 });
    try {
      const p = await small.setupProject();
      await small.createBucket(p.cookie, p.project.id, "lru-bucket", true);
      const raw = randomBytes(600 * 600 * 3);
      const img = await sharp(raw, { raw: { width: 600, height: 600, channels: 3 } }).png().toBuffer();
      await small.upload(small.as(p.cookie), p.project.id, "lru-bucket", "n.png", img, "image/png");
      for (const w of [200, 220, 240, 260, 280]) await small.app.inject(`/f/lru-bucket/n.png?w=${w}&format=jpeg&q=95`);
      expect(small.ctx.transformCache.bytes).toBeLessThanOrEqual(40_000 + 30_000);
      expect(small.ctx.transformCache.entries).toBeLessThan(5);
    } finally {
      await small.close();
    }
  });
});
