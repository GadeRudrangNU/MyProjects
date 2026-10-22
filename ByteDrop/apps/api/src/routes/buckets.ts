import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { eq, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  bucketSchema,
  createBucketSchema,
  listObjectsQuery,
  objectPageSchema,
  objectSchema,
  signedLinkSchema,
  signLinkSchema,
} from "@bytedrop/shared";
import { authorize } from "../access";
import type { Auth } from "../auth";
import type { AppContext } from "../context";
import { buckets, objects } from "../db/schema";
import { guessContentType, validateKey } from "../mime";
import { buildSignedUrl } from "../services/signing";
import { commitObject, deleteObject, findBucket, listObjects } from "../services/objects";
import { HttpError } from "../util";

const projectParams = z.object({ projectId: z.string().uuid() });
const bucketParams = projectParams.extend({ bucket: z.string() });

export const bucketRoutes: FastifyPluginAsyncZod<{ ctx: AppContext; auth: Auth }> = async (app, { ctx }) => {
  app.get(
    "/v1/projects/:projectId/buckets",
    {
      schema: {
        tags: ["buckets"],
        summary: "List buckets",
        params: projectParams,
        response: { 200: z.array(bucketSchema) },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "read");
      const rows = await ctx.db
        .select({
          id: buckets.id,
          name: buckets.name,
          isPublic: buckets.isPublic,
          createdAt: buckets.createdAt,
          objectCount: sql<number>`(select count(*)::int from objects o where o.bucket_id = buckets.id)`,
          totalBytes: sql<number>`(select coalesce(sum(o.size), 0)::float8 from objects o where o.bucket_id = buckets.id)`,
        })
        .from(buckets)
        .where(eq(buckets.projectId, req.params.projectId))
        .orderBy(buckets.name);
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    },
  );

  app.post(
    "/v1/projects/:projectId/buckets",
    {
      schema: {
        tags: ["buckets"],
        summary: "Create a bucket (names are globally unique)",
        params: projectParams,
        body: createBucketSchema,
        response: { 201: bucketSchema },
      },
    },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "write");
      try {
        ctx.deliveryMeta.invalidateBucket(req.body.name);
        const [row] = await ctx.db
          .insert(buckets)
          .values({ projectId: req.params.projectId, name: req.body.name, isPublic: req.body.isPublic })
          .returning();
        return reply.status(201).send({
          id: row!.id,
          name: row!.name,
          isPublic: row!.isPublic,
          createdAt: row!.createdAt.toISOString(),
          objectCount: 0,
          totalBytes: 0,
        });
      } catch (err) {
        const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
        if (code === "23505") {
          throw new HttpError(409, "bucket_exists", `Bucket "${req.body.name}" already exists`);
        }
        throw err;
      }
    },
  );

  app.delete(
    "/v1/projects/:projectId/buckets/:bucket",
    { schema: { tags: ["buckets"], summary: "Delete an empty bucket", params: bucketParams } },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "write");
      const b = await findBucket(ctx.db, req.params.projectId, req.params.bucket);
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(objects)
        .where(eq(objects.bucketId, b.id));
      if (n > 0) throw new HttpError(409, "bucket_not_empty", "Delete the bucket's files first");
      await ctx.db.delete(buckets).where(eq(buckets.id, b.id));
      ctx.deliveryMeta.invalidateBucket(b.name);
      return reply.status(204).send();
    },
  );

  app.get(
    "/v1/projects/:projectId/buckets/:bucket/objects",
    {
      schema: {
        tags: ["files"],
        summary: "List files with cursor pagination",
        params: bucketParams,
        querystring: listObjectsQuery,
        response: { 200: objectPageSchema },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "read");
      const b = await findBucket(ctx.db, req.params.projectId, req.params.bucket);
      return listObjects(ctx.db, b.id, req.query);
    },
  );

  app.post(
    "/v1/projects/:projectId/buckets/:bucket/objects",
    {
      schema: {
        tags: ["files"],
        summary: "Upload a file (multipart/form-data, field `file`; key from `?key=` or a `key` field sent before the file)",
        description: "For large files use resumable upload sessions instead.",
        params: bucketParams,
        querystring: z.object({ key: z.string().optional() }),
        consumes: ["multipart/form-data"],
        response: { 201: objectSchema },
      },
    },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "write");
      const b = await findBucket(ctx.db, req.params.projectId, req.params.bucket);
      const part = await req.file();
      if (!part) throw new HttpError(400, "file_required", "Send a multipart body with a `file` field");
      const fieldKey = (part.fields.key as { value?: string } | undefined)?.value;
      const key = req.query.key ?? fieldKey ?? part.filename;
      const bad = validateKey(key);
      if (bad) throw new HttpError(400, "invalid_key", bad);

      const tmp = ctx.storage.tempPath(`up-${randomUUID()}`);
      const hash = createHash("sha256");
      let size = 0;
      try {
        await pipeline(
          part.file,
          new Transform({
            transform(chunk: Buffer, _enc, cb) {
              hash.update(chunk);
              size += chunk.length;
              cb(null, chunk);
            },
          }),
          createWriteStream(tmp),
        );
        if (part.file.truncated) throw new HttpError(413, "payload_too_large", "File exceeds the upload limit");
        const stored = await commitObject(ctx, {
          bucket: { id: b.id, name: b.name, projectId: b.projectId },
          key,
          tmpFile: tmp,
          hash: hash.digest("hex"),
          size,
          contentType: guessContentType(key, part.mimetype),
        });
        return reply.status(201).send(stored);
      } catch (err) {
        ctx.metrics.uploadFailures.inc({ reason: err instanceof HttpError ? err.code : "error" });
        throw err;
      } finally {
        await rm(tmp, { force: true });
      }
    },
  );

  app.delete(
    "/v1/projects/:projectId/buckets/:bucket/objects",
    {
      schema: {
        tags: ["files"],
        summary: "Delete a file",
        params: bucketParams,
        querystring: z.object({ key: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "write");
      const b = await findBucket(ctx.db, req.params.projectId, req.params.bucket);
      const ok = await deleteObject(ctx, { id: b.id, name: b.name, projectId: b.projectId }, req.query.key);
      if (!ok) throw new HttpError(404, "object_not_found", "File not found");
      return reply.status(204).send();
    },
  );

  app.post(
    "/v1/projects/:projectId/buckets/:bucket/sign",
    {
      schema: {
        tags: ["files"],
        summary: "Create a signed, expiring download link",
        params: bucketParams,
        body: signLinkSchema,
        response: { 200: signedLinkSchema },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "read");
      const b = await findBucket(ctx.db, req.params.projectId, req.params.bucket);
      return buildSignedUrl(
        ctx.cfg.PUBLIC_URL,
        ctx.cfg.URL_SIGNING_SECRET,
        b.name,
        req.body.key,
        req.body.expiresInSeconds,
      );
    },
  );
};
