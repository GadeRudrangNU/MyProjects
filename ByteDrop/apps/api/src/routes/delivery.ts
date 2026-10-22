import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { transformQuery } from "@bytedrop/shared";
import { extractApiKey, resolvePrincipal } from "../access";
import type { Auth } from "../auth";
import type { AppContext } from "../context";
import { buckets, objects, projects } from "../db/schema";
import { ImageTransformer } from "../services/transformer";
import { checkSignature } from "../services/signing";
import { HttpError } from "../util";

interface DeliveryInfo {
  projectId: string;
  bucketId: string;
  bucket: string;
  key: string;
  kind: string;
  cache: "HIT" | "MISS" | "REVALIDATED" | "BYPASS";
}

declare module "fastify" {
  interface FastifyRequest {
    delivery?: DeliveryInfo;
  }
}

export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "invalid" | null {
  if (!header || size === 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return header.trim().startsWith("bytes=") && !header.includes(",") ? "invalid" : null;
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const strip = (v: string) => v.trim().replace(/^W\//, "");
  return header.split(",").some((t) => strip(t) === etag);
}

function disposition(key: string, download: boolean) {
  const name = path.posix.basename(key);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const deliveryQuery = transformQuery.extend({
  exp: z.string().optional(),
  sig: z.string().optional(),
  download: z.string().optional(),
});

export const deliveryRoutes: FastifyPluginAsyncZod<{ ctx: AppContext; auth: Auth }> = async (app, { ctx, auth }) => {
  const track = (req: FastifyRequest, status: number, bytes: number, elapsedMs: number) => {
    const d = req.delivery;
    if (!d) return;
    let referrer: string | null = null;
    const ref = req.headers.referer;
    if (ref) {
      try {
        referrer = new URL(ref).host;
      } catch {
        referrer = null;
      }
    }
    ctx.events.push({
      projectId: d.projectId,
      bucketId: d.bucketId,
      bucket: d.bucket,
      objectKey: d.key,
      kind: d.kind,
      status,
      bytes,
      cache: status >= 400 ? "BYPASS" : d.cache,
      latencyMs: Math.max(0, Math.round(elapsedMs)),
      referrer,
    });
  };

  app.route({
    method: ["GET", "HEAD"],
    url: "/f/:bucket/*",
    logLevel: "warn",
    config: { hot: true },
    schema: {
      tags: ["delivery"],
      summary: "Deliver a file",
      description:
        "Supports ETag/If-None-Match (304), Range (206), signed expiring links for private buckets (403 bad signature, 410 expired) and on-the-fly image transforms (w, h, q, format, fit).",
      params: z.object({ bucket: z.string(), "*": z.string() }),
      querystring: deliveryQuery,
      security: [],
    },
    onResponse: async (req, reply) => {
      const len = Number(reply.getHeader("content-length") ?? 0);
      track(req, reply.statusCode, reply.statusCode === 304 || req.method === "HEAD" ? 0 : len, reply.elapsedTime);
    },
    handler: async (req, reply) => {
      const bucketName = req.params.bucket;
      const key = req.params["*"];
      const q = req.query;

      reply.header("access-control-allow-origin", "*");
      reply.header("access-control-expose-headers", "etag, content-range, accept-ranges, content-length");

      const row = await ctx.deliveryMeta.lookup(bucketName, key, async () => {
        const [found] = await ctx.db
          .select({ bucket: buckets, object: objects })
          .from(buckets)
          .leftJoin(objects, and(eq(objects.bucketId, buckets.id), eq(objects.key, key)))
          .where(eq(buckets.name, bucketName))
          .limit(1);
        return found;
      });
      if (!row) throw new HttpError(404, "not_found", "File not found");
      const bucket = row.bucket;
      req.delivery = {
        projectId: bucket.projectId,
        bucketId: bucket.id,
        bucket: bucket.name,
        key,
        kind: row.object?.kind ?? "other",
        cache: "HIT",
      };

      let privateTtl = 60;
      if (!bucket.isPublic) {
        if (q.sig) {
          const result = checkSignature(ctx.cfg.URL_SIGNING_SECRET, bucket.name, key, q.exp ?? "", q.sig);
          if (result === "invalid") throw new HttpError(403, "invalid_signature", "Signature does not match");
          if (result === "expired") throw new HttpError(410, "link_expired", "This link has expired");
          privateTtl = Math.max(0, Math.min(60, Number(q.exp) - Math.floor(Date.now() / 1000)));
        } else {
          const apiKey = extractApiKey(req);
          if (!apiKey && !req.headers.cookie) {
            throw new HttpError(401, "unauthorized", "Private bucket: use a signed link or an API key");
          }
          const p = await resolvePrincipal(ctx, auth, req);
          if (p.kind === "anonymous") throw new HttpError(401, "unauthorized", "Private bucket: use a signed link or an API key");
          if (p.kind === "key") {
            if (p.projectId !== bucket.projectId) throw new HttpError(403, "forbidden", "API key belongs to another project");
            const limit = app.limiter.take(p.id);
            if (!limit.ok) {
              throw new HttpError(429, "rate_limited", "Too many requests", { "retry-after": String(limit.retryAfterSec) });
            }
          } else {
            const [owned] = await ctx.db
              .select({ id: projects.id })
              .from(projects)
              .where(and(eq(projects.id, bucket.projectId), eq(projects.ownerId, p.userId)))
              .limit(1);
            if (!owned) throw new HttpError(403, "forbidden", "No access to this bucket");
          }
        }
      }

      const obj = row.object;
      if (!obj) throw new HttpError(404, "not_found", "File not found");

      const wantsTransform = ImageTransformer.isTransformRequest(q);
      if (wantsTransform && obj.kind !== "image") {
        throw new HttpError(400, "not_an_image", "Transforms only apply to images");
      }

      let etag: string;
      let contentType = obj.contentType;
      let size = obj.size;
      let open: (range?: { start: number; end: number }) => NodeJS.ReadableStream | Promise<Buffer>;
      const params = transformQuery.parse(q);

      if (wantsTransform) {
        const tkey = ctx.transformer.keyFor(obj.blobHash, obj.contentType, params);
        etag = `"t-${tkey.replace(/\.[a-z0-9]+$/, "")}"`;
      } else {
        etag = `"${obj.blobHash.slice(0, 32)}"`;
      }

      const cacheControl = bucket.isPublic
        ? "public, max-age=300, stale-while-revalidate=60"
        : `private, max-age=${privateTtl}`;
      reply.header("etag", etag);
      reply.header("cache-control", cacheControl);
      reply.header("accept-ranges", "bytes");
      reply.header("last-modified", obj.updatedAt.toUTCString());

      if (matchesEtag(req.headers["if-none-match"], etag)) {
        req.delivery.cache = "REVALIDATED";
        ctx.metrics.cacheEvents.inc({ layer: "etag", result: "not_modified" });
        return reply.status(304).send();
      }

      if (wantsTransform) {
        const t = await ctx.transformer.get(obj.blobHash, obj.contentType, params);
        req.delivery.cache = t.state;
        contentType = t.contentType;
        size = t.size;
        open = (range) => {
          if (t.size > ctx.hotFiles.maxItemBytes || !ctx.hotFiles.enabled) return createReadStream(t.path, range);
          return ctx.hotFiles.get(`t:${t.key}`, () => readFile(t.path)).then((b) => (range ? b.subarray(range.start, range.end + 1) : b));
        };
      } else {
        ctx.metrics.cacheEvents.inc({ layer: "etag", result: "full" });
        open = (range) => {
          if (obj.size > ctx.hotFiles.maxItemBytes || !ctx.hotFiles.enabled) return ctx.storage.open(obj.blobHash, range);
          return ctx.hotFiles
            .get(obj.blobHash, () => readFile(ctx.storage.localPath(obj.blobHash)))
            .then((b) => (range ? b.subarray(range.start, range.end + 1) : b));
        };
      }

      reply.header("content-type", contentType);
      reply.header("content-disposition", disposition(key, q.download !== undefined));

      const ifRange = req.headers["if-range"];
      const rangeAllowed = !ifRange || ifRange === etag;
      const range = rangeAllowed ? parseRange(req.headers.range, size) : null;

      if (range === "invalid") {
        reply.header("content-range", `bytes */${size}`);
        throw new HttpError(416, "range_not_satisfiable", "Requested range not satisfiable", { "content-range": `bytes */${size}` });
      }

      if (range) {
        reply.status(206);
        reply.header("content-range", `bytes ${range.start}-${range.end}/${size}`);
        reply.header("content-length", String(range.end - range.start + 1));
        if (req.method === "HEAD") return reply.send();
        return reply.send(await open(range));
      }
      reply.header("content-length", String(size));
      if (req.method === "HEAD") return reply.send();
      return reply.send(await open());
    },
  });
};
