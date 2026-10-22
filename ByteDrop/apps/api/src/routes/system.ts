import { eq, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../auth";
import type { AppContext } from "../context";
import { webhookDeliveries } from "../db/schema";
import { HttpError } from "../util";

export const systemRoutes: FastifyPluginAsyncZod<{ ctx: AppContext; auth: Auth }> = async (app, { ctx, auth }) => {
  app.get(
    "/health",
    { schema: { tags: ["system"], summary: "Liveness probe", response: { 200: z.object({ status: z.literal("ok") }) } } },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/ready",
    {
      schema: {
        tags: ["system"],
        summary: "Readiness probe (database and disk)",
        response: {
          200: z.object({ status: z.literal("ready") }),
          503: z.object({ status: z.literal("unavailable"), checks: z.record(z.string(), z.string()) }),
        },
      },
    },
    async (_req, reply) => {
      const checks: Record<string, string> = {};
      try {
        await ctx.pool.query("select 1");
        checks.database = "ok";
      } catch (err) {
        checks.database = (err as Error).message;
      }
      try {
        await ctx.storage.checkWritable();
        checks.disk = "ok";
      } catch (err) {
        checks.disk = (err as Error).message;
      }
      if (Object.values(checks).every((v) => v === "ok")) return { status: "ready" as const };
      return reply.status(503).send({ status: "unavailable" as const, checks });
    },
  );

  app.get("/metrics", { schema: { hide: true } }, async (_req, reply) => {
    const [row] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.status, "pending"));
    ctx.metrics.webhookBacklog.set(row?.n ?? 0);
    return reply.header("content-type", ctx.metrics.registry.contentType).send(await ctx.metrics.registry.metrics());
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    schema: { hide: true },
    handler: async (req, reply) => {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined;
      const response = await auth.handler(
        new Request(url, { method: req.method, headers, body: hasBody ? JSON.stringify(req.body) : undefined }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });

  app.get(
    "/v1/me",
    {
      schema: {
        tags: ["account"],
        summary: "Current dashboard user",
        response: { 200: z.object({ id: z.string(), email: z.string(), name: z.string() }) },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p || p.kind !== "session") throw new HttpError(401, "unauthorized", "Sign in required");
      const session = await auth.api.getSession({ headers: new Headers({ cookie: req.headers.cookie ?? "" }) });
      if (!session) throw new HttpError(401, "unauthorized", "Sign in required");
      return { id: session.user.id, email: session.user.email, name: session.user.name };
    },
  );
};
