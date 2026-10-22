import client from "prom-client";

export function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  return {
    registry,
    httpDuration: new client.Histogram({
      name: "bytedrop_http_request_duration_seconds",
      help: "HTTP request latency",
      labelNames: ["method", "route", "status"] as const,
      buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    cacheEvents: new client.Counter({
      name: "bytedrop_cache_events_total",
      help: "Delivery cache outcomes",
      labelNames: ["layer", "result"] as const,
      registers: [registry],
    }),
    uploadFailures: new client.Counter({
      name: "bytedrop_upload_failures_total",
      help: "Failed uploads and rejected chunks",
      labelNames: ["reason"] as const,
      registers: [registry],
    }),
    transformCacheBytes: new client.Gauge({
      name: "bytedrop_transform_cache_bytes",
      help: "Bytes held by the transform cache",
      registers: [registry],
    }),
    webhookBacklog: new client.Gauge({
      name: "bytedrop_webhook_backlog",
      help: "Webhook deliveries waiting to be sent",
      registers: [registry],
    }),
    webhookAttempts: new client.Counter({
      name: "bytedrop_webhook_attempts_total",
      help: "Webhook delivery attempts",
      labelNames: ["outcome"] as const,
      registers: [registry],
    }),
    webhookAttemptDuration: new client.Histogram({
      name: "bytedrop_webhook_attempt_duration_seconds",
      help: "Webhook receiver response time",
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [registry],
    }),
    jobDuration: new client.Histogram({
      name: "bytedrop_job_duration_seconds",
      help: "Background job duration",
      labelNames: ["queue"] as const,
      buckets: [0.005, 0.025, 0.1, 0.5, 1, 5, 30],
      registers: [registry],
    }),
    jobFailures: new client.Counter({
      name: "bytedrop_job_failures_total",
      help: "Background job failures",
      labelNames: ["queue"] as const,
      registers: [registry],
    }),
    analyticsBuffered: new client.Gauge({
      name: "bytedrop_analytics_buffered_events",
      help: "Delivery events waiting to be flushed",
      registers: [registry],
    }),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
