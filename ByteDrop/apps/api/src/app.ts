import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import { context, propagation, SpanKind, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import scalar from "@scalar/fastify-api-reference";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyError } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { resolvePrincipal } from "./access";
import type { Auth } from "./auth";
import type { AppContext } from "./context";
import { analyticsRoutes } from "./routes/analytics";
import { bucketRoutes } from "./routes/buckets";
import { deliveryRoutes } from "./routes/delivery";
import { projectRoutes } from "./routes/projects";
import { systemRoutes } from "./routes/system";
import { uploadRoutes } from "./routes/uploads";
import { webhookRoutes } from "./routes/webhooks";
import { RateLimiter } from "./services/rate-limit";
import { tracer } from "./telemetry";
import { HttpError } from "./util";

declare module "fastify" {
  interface FastifyRequest {
    span?: Span;
  }
  interface FastifyContextConfig {
    hot?: boolean;
  }
}

export async function buildApp(ctx: AppContext, auth: Auth) {
  const app = Fastify({
    loggerInstance: ctx.log,
    genReqId: (req) => (typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : randomUUID()),
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const limiter = new RateLimiter(ctx.cfg.RATE_LIMIT_PER_MIN);
  app.decorate("limiter", limiter);

  // Probes and file delivery are high-volume: they skip the per-request logger child and probes skip tracing entirely.
  // Deliveries are recorded as analytics events instead of log lines.
  const isProbe = (url: string) => url === "/health" || url === "/ready" || url.startsWith("/metrics");

  app.addHook("onRequest", (req, reply, done) => {
    reply.header("x-request-id", req.id);
    if (isProbe(req.url)) return done();
    const parent = propagation.extract(context.active(), req.headers);
    const span = tracer().startSpan(`${req.method} ${req.url.split("?")[0]}`, { kind: SpanKind.SERVER }, parent);
    req.span = span;
    if (!req.routeOptions.config.hot) {
      req.log = req.log.child({ traceId: span.spanContext().traceId });
      reply.log = req.log;
    }
    context.with(trace.setSpan(parent, span), done);
  });

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/v1/")) return;
    req.principal = await resolvePrincipal(ctx, auth, req);
    const r = limiter.take(req.principal.id);
    reply.header("x-ratelimit-limit", r.limit);
    reply.header("x-ratelimit-remaining", r.remaining);
    if (!r.ok) {
      throw new HttpError(429, "rate_limited", "Too many requests", { "retry-after": String(r.retryAfterSec) });
    }
  });

  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions.url ?? "unmatched";
    ctx.metrics.httpDuration.observe(
      { method: req.method, route, status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
    const span = req.span;
    if (span) {
      span.updateName(`${req.method} ${route}`);
      span.setAttributes({ "http.status_code": reply.statusCode, "http.route": route, "request.id": req.id });
      if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    for (const h of ["content-type", "content-length", "content-disposition", "content-range", "etag"]) {
      reply.removeHeader(h);
    }
    if (err instanceof HttpError) {
      for (const [k, v] of Object.entries(err.headers)) reply.header(k, v);
      return reply
        .status(err.status)
        .send({ error: { code: err.code, message: err.message, requestId: req.id, ...err.extra } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: err.validation.map((v) => `${v.instancePath || "request"} ${v.message}`).join("; "),
          requestId: req.id,
        },
      });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "unhandled error");
    return reply.status(status).send({
      error: {
        code: status === 413 ? "payload_too_large" : status >= 500 ? "internal_error" : "bad_request",
        message: status >= 500 ? "Internal server error" : err.message,
        requestId: req.id,
      },
    });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: "Route not found", requestId: req.id } }),
  );

  await app.register(cors, {
    origin: [ctx.cfg.WEB_ORIGIN],
    credentials: true,
    exposedHeaders: ["etag", "content-range", "accept-ranges", "retry-after", "x-request-id", "upload-offset"],
  });
  await app.register(multipart, { limits: { fileSize: 256 * 1024 * 1024, files: 1 } });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 16 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "ByteDrop API",
        version: "0.1.0",
        description: "Storage and delivery API: buckets, resumable uploads, cacheable delivery, analytics and webhooks.",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", description: "Project API key (bd_...)" },
          cookieAuth: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
        },
      },
      security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(scalar, { routePrefix: "/docs" });

  const opts = { ctx, auth };
  await app.register(systemRoutes, opts);
  await app.register(projectRoutes, opts);
  await app.register(bucketRoutes, opts);
  await app.register(uploadRoutes, opts);
  await app.register(deliveryRoutes, opts);
  await app.register(analyticsRoutes, opts);
  await app.register(webhookRoutes, opts);

  app.addHook("onClose", async () => {
    await ctx.events.stop();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    limiter: RateLimiter;
  }
}
