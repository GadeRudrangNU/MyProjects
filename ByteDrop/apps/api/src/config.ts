import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("127.0.0.1"),
  WORKER_PORT: z.coerce.number().default(4001),
  PUBLIC_URL: z.string().default("http://localhost:4000"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@127.0.0.1:54340/bytedrop"),
  DATA_DIR: z.string().default(path.resolve(process.cwd(), "../../.data")),
  AUTH_SECRET: z.string().default("dev-only-secret-change-me-dev-only-secret"),
  URL_SIGNING_SECRET: z.string().default("dev-only-signing-secret"),
  LOG_LEVEL: z.string().default("info"),
  RATE_LIMIT_PER_MIN: z.coerce.number().default(600),
  DEFAULT_QUOTA_BYTES: z.coerce.number().default(500 * 1024 * 1024),
  TRANSFORM_CACHE_BYTES: z.coerce.number().default(256 * 1024 * 1024),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  TRACE_STDOUT: z.string().optional(),
  DEMO_SEED: z.string().optional(),
  HOT_CACHE_BYTES: z.coerce.number().default(64 * 1024 * 1024),
  DELIVERY_META_TTL_MS: z.coerce.number().default(1000),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().default(5000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().default(6),
  WEBHOOK_BACKOFF_MS: z.coerce.number().default(5000),
  WEBHOOK_BREAKER: z.enum(["on", "off"]).default("on"),
  WEBHOOK_BREAKER_THRESHOLD: z.coerce.number().default(5),
  WEBHOOK_BREAKER_COOLDOWN_MS: z.coerce.number().default(30000),
  WEBHOOK_CONCURRENCY: z.coerce.number().default(4),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const parsed = envSchema.parse({ ...process.env });
  return { ...parsed, ...overrides };
}
