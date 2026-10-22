import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createdWebhookSchema,
  createWebhookSchema,
  deliveryPageSchema,
  deliveryQuery,
  webhookDeliverySchema,
  webhookEndpointSchema,
  type WebhookEvent,
} from "@bytedrop/shared";
import { authorize } from "../access";
import type { Auth } from "../auth";
import type { AppContext } from "../context";
import { webhookEndpoints } from "../db/schema";
import { listDeliveries, replayDelivery, toDelivery } from "../services/webhooks";
import { HttpError, decodeCursor, encodeCursor, newSecret } from "../util";

const projectParams = z.object({ projectId: z.string().uuid() });

const toEndpoint = (e: typeof webhookEndpoints.$inferSelect) => ({
  id: e.id,
  url: e.url,
  events: e.events as WebhookEvent[],
  active: e.active,
  createdAt: e.createdAt.toISOString(),
});

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?$|0\.0\.0\.0)/i;

export const webhookRoutes: FastifyPluginAsyncZod<{ ctx: AppContext; auth: Auth }> = async (app, { ctx }) => {
  app.get(
    "/v1/projects/:projectId/webhooks",
    {
      schema: {
        tags: ["webhooks"],
        summary: "List webhook endpoints",
        params: projectParams,
        response: { 200: z.array(webhookEndpointSchema) },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "read");
      const rows = await ctx.db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.projectId, req.params.projectId))
        .orderBy(desc(webhookEndpoints.createdAt));
      return rows.map(toEndpoint);
    },
  );

  app.post(
    "/v1/projects/:projectId/webhooks",
    {
      schema: {
        tags: ["webhooks"],
        summary: "Add a webhook endpoint; the signing secret is shown once",
        params: projectParams,
        body: createWebhookSchema,
        response: { 201: createdWebhookSchema },
      },
    },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "write");
      const host = new URL(req.body.url).hostname;
      if (ctx.cfg.NODE_ENV === "production" && PRIVATE_HOST.test(host)) {
        throw new HttpError(400, "private_destination", "Webhook URLs must not point at private addresses");
      }
      const secret = newSecret("whsec_");
      const [row] = await ctx.db
        .insert(webhookEndpoints)
        .values({ projectId: req.params.projectId, url: req.body.url, events: req.body.events, secret })
        .returning();
      return reply.status(201).send({ ...toEndpoint(row!), secret });
    },
  );

  app.delete(
    "/v1/projects/:projectId/webhooks/:webhookId",
    {
      schema: {
        tags: ["webhooks"],
        summary: "Remove a webhook endpoint",
        params: projectParams.extend({ webhookId: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      await authorize(ctx, req, req.params.projectId, "write");
      const rows = await ctx.db
        .delete(webhookEndpoints)
        .where(and(eq(webhookEndpoints.id, req.params.webhookId), eq(webhookEndpoints.projectId, req.params.projectId)))
        .returning({ id: webhookEndpoints.id });
      if (rows.length === 0) throw new HttpError(404, "webhook_not_found", "Webhook not found");
      return reply.status(204).send();
    },
  );

  app.get(
    "/v1/projects/:projectId/webhooks/deliveries",
    {
      schema: {
        tags: ["webhooks"],
        summary: "Delivery log: status, response time and attempt count of every delivery",
        params: projectParams,
        querystring: deliveryQuery,
        response: { 200: deliveryPageSchema },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "read");
      return listDeliveries(ctx, req.params.projectId, req.query, (c) => decodeCursor<[string, string]>(c), encodeCursor);
    },
  );

  app.post(
    "/v1/projects/:projectId/webhooks/deliveries/:deliveryId/replay",
    {
      schema: {
        tags: ["webhooks"],
        summary: "Resend a delivery",
        params: projectParams.extend({ deliveryId: z.string().uuid() }),
        response: { 200: webhookDeliverySchema },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "write");
      const row = await replayDelivery(ctx, req.params.projectId, req.params.deliveryId);
      if (!row) throw new HttpError(404, "delivery_not_found", "Delivery not found");
      return toDelivery(row);
    },
  );
};
