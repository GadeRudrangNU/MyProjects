import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  apiKeySchema,
  createApiKeySchema,
  createdApiKeySchema,
  createProjectSchema,
  projectSchema,
} from "@bytedrop/shared";
import { authorize } from "../access";
import type { Auth } from "../auth";
import type { AppContext } from "../context";
import { apiKeys, projects } from "../db/schema";
import { HttpError, newSecret, sha256Hex } from "../util";

const projectParams = z.object({ projectId: z.string().uuid() });

const toProject = (p: typeof projects.$inferSelect) => ({
  id: p.id,
  name: p.name,
  quotaBytes: p.quotaBytes,
  usedBytes: p.usedBytes,
  createdAt: p.createdAt.toISOString(),
});

const toKey = (k: typeof apiKeys.$inferSelect) => ({
  id: k.id,
  name: k.name,
  prefix: k.prefix,
  scope: k.scope,
  createdAt: k.createdAt.toISOString(),
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  revokedAt: k.revokedAt?.toISOString() ?? null,
});

export const projectRoutes: FastifyPluginAsyncZod<{ ctx: AppContext; auth: Auth }> = async (app, { ctx }) => {
  app.get(
    "/v1/projects",
    { schema: { tags: ["projects"], summary: "List your projects", response: { 200: z.array(projectSchema) } } },
    async (req) => {
      if (req.principal?.kind !== "session") throw new HttpError(401, "unauthorized", "Sign in required");
      const rows = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.ownerId, req.principal.userId))
        .orderBy(desc(projects.createdAt));
      return rows.map(toProject);
    },
  );

  app.post(
    "/v1/projects",
    {
      schema: {
        tags: ["projects"],
        summary: "Create a project",
        body: createProjectSchema,
        response: { 201: projectSchema },
      },
    },
    async (req, reply) => {
      if (req.principal?.kind !== "session") throw new HttpError(401, "unauthorized", "Sign in required");
      const [row] = await ctx.db
        .insert(projects)
        .values({ ownerId: req.principal.userId, name: req.body.name, quotaBytes: ctx.cfg.DEFAULT_QUOTA_BYTES })
        .returning();
      return reply.status(201).send(toProject(row!));
    },
  );

  app.get(
    "/v1/projects/:projectId",
    {
      schema: {
        tags: ["projects"],
        summary: "Get a project with its storage usage",
        params: projectParams,
        response: { 200: projectSchema },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "read");
      const [row] = await ctx.db.select().from(projects).where(eq(projects.id, req.params.projectId));
      if (!row) throw new HttpError(404, "project_not_found", "Project not found");
      return toProject(row);
    },
  );

  app.get(
    "/v1/projects/:projectId/keys",
    {
      schema: {
        tags: ["api keys"],
        summary: "List API keys (secrets are never returned)",
        params: projectParams,
        response: { 200: z.array(apiKeySchema) },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "admin");
      const rows = await ctx.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.projectId, req.params.projectId))
        .orderBy(desc(apiKeys.createdAt));
      return rows.map(toKey);
    },
  );

  app.post(
    "/v1/projects/:projectId/keys",
    {
      schema: {
        tags: ["api keys"],
        summary: "Create an API key; the secret is shown once",
        params: projectParams,
        body: createApiKeySchema,
        response: { 201: createdApiKeySchema },
      },
    },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "admin");
      const secret = newSecret("bd_live_");
      const [row] = await ctx.db
        .insert(apiKeys)
        .values({
          projectId: req.params.projectId,
          name: req.body.name,
          scope: req.body.scope,
          prefix: secret.slice(0, 14),
          keyHash: sha256Hex(secret),
        })
        .returning();
      return reply.status(201).send({ ...toKey(row!), secret });
    },
  );

  app.delete(
    "/v1/projects/:projectId/keys/:keyId",
    {
      schema: {
        tags: ["api keys"],
        summary: "Revoke an API key",
        params: projectParams.extend({ keyId: z.string().uuid() }),
        response: { 200: apiKeySchema },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "admin");
      const [row] = await ctx.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, req.params.keyId), eq(apiKeys.projectId, req.params.projectId)))
        .returning();
      if (!row) throw new HttpError(404, "key_not_found", "API key not found");
      return toKey(row);
    },
  );
};
