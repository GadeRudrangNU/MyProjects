import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { createUploadSchema, uploadSessionSchema } from "@bytedrop/shared";
import { authorize } from "../access";
import type { Auth } from "../auth";
import type { AppContext } from "../context";
import { validateKey, guessContentType } from "../mime";
import { findBucket } from "../services/objects";
import { appendChunk, cancelUpload, createUpload, sessionView } from "../services/uploads";
import { HttpError } from "../util";

const projectParams = z.object({ projectId: z.string().uuid() });
const uploadParams = projectParams.extend({ uploadId: z.string().uuid() });

export const uploadRoutes: FastifyPluginAsyncZod<{ ctx: AppContext; auth: Auth }> = async (app, { ctx }) => {
  app.post(
    "/v1/projects/:projectId/buckets/:bucket/uploads",
    {
      schema: {
        tags: ["resumable uploads"],
        summary: "Start a resumable upload session",
        description:
          "Declare the key, size and whole-file sha256. Send chunks with PATCH; the file is assembled only when the final hash matches. Identical content that is already stored completes immediately.",
        params: projectParams.extend({ bucket: z.string() }),
        body: createUploadSchema,
        response: { 201: uploadSessionSchema },
      },
    },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "write");
      const bad = validateKey(req.body.key);
      if (bad) throw new HttpError(400, "invalid_key", bad);
      const b = await findBucket(ctx.db, req.params.projectId, req.params.bucket);
      const session = await createUpload(ctx, {
        projectId: b.projectId,
        bucketId: b.id,
        bucketName: b.name,
        key: req.body.key,
        size: req.body.size,
        sha256: req.body.sha256,
        contentType: guessContentType(req.body.key, req.body.contentType),
      });
      return reply.status(201).send(session);
    },
  );

  app.get(
    "/v1/projects/:projectId/uploads/:uploadId",
    {
      schema: {
        tags: ["resumable uploads"],
        summary: "Ask for the current offset so an interrupted upload can continue",
        params: uploadParams,
        response: { 200: uploadSessionSchema },
      },
    },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "write");
      const view = await sessionView(ctx, req.params.projectId, req.params.uploadId);
      return reply.header("upload-offset", String(view.offset)).send(view);
    },
  );

  app.patch(
    "/v1/projects/:projectId/uploads/:uploadId",
    {
      bodyLimit: 16 * 1024 * 1024,
      schema: {
        tags: ["resumable uploads"],
        summary: "Append a chunk",
        description: "Body is the raw chunk (application/octet-stream).",
        params: uploadParams,
        headers: z.object({
          "upload-offset": z.coerce.number().int().min(0),
          "x-chunk-sha256": z.string().regex(/^[a-f0-9]{64}$/),
        }),
        consumes: ["application/octet-stream"],
        response: { 200: uploadSessionSchema },
      },
    },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "write");
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body)) throw new HttpError(415, "unsupported_media_type", "Send application/octet-stream");
      const view = await appendChunk(
        ctx,
        req.params.projectId,
        req.params.uploadId,
        req.headers["upload-offset"],
        req.headers["x-chunk-sha256"],
        body,
      );
      return reply.header("upload-offset", String(view.offset)).send(view);
    },
  );

  app.delete(
    "/v1/projects/:projectId/uploads/:uploadId",
    { schema: { tags: ["resumable uploads"], summary: "Cancel an upload", params: uploadParams } },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "write");
      await cancelUpload(ctx, req.params.projectId, req.params.uploadId);
      return reply.status(204).send();
    },
  );
};
