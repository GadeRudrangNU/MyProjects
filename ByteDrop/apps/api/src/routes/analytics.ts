import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { analyticsQuery, analyticsSchema } from "@bytedrop/shared";
import { authorize } from "../access";
import type { Auth } from "../auth";
import type { AppContext } from "../context";
import { queryAnalytics, refreshAnalytics } from "../services/analytics";

const params = z.object({ projectId: z.string().uuid() });

export const analyticsRoutes: FastifyPluginAsyncZod<{ ctx: AppContext; auth: Auth }> = async (app, { ctx }) => {
  app.get(
    "/v1/projects/:projectId/analytics",
    {
      schema: {
        tags: ["analytics"],
        summary: "Delivery analytics: requests, bandwidth, cache hit rate, p95 latency, top files and referrers",
        params,
        querystring: analyticsQuery,
        response: { 200: analyticsSchema },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "read");
      return queryAnalytics(ctx.db, req.params.projectId, req.query);
    },
  );

  app.post(
    "/v1/projects/:projectId/analytics/refresh",
    {
      schema: {
        tags: ["analytics"],
        summary: "Flush buffered events and recompute the latest hourly summaries now",
        params,
        response: { 200: z.object({ groups: z.number() }) },
      },
    },
    async (req) => {
      await authorize(ctx, req, req.params.projectId, "write");
      return { groups: await refreshAnalytics(ctx) };
    },
  );
};
