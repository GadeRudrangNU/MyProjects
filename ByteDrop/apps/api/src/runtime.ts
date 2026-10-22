import path from "node:path";
import { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import type { AppContext, DeliveryRow } from "./context";
import type { Config } from "./config";
import { createDb } from "./db/client";
import { createJobs, ensureQueues, noopJobs } from "./jobs/queues";
import { createLogger } from "./logger";
import { createMetrics } from "./metrics";
import { EventBuffer } from "./services/events";
import { HotFileCache } from "./services/hot-cache";
import { MetaCache } from "./services/meta-cache";
import { ImageTransformer } from "./services/transformer";
import { LocalStorageDriver } from "./storage/local";
import { TransformCache } from "./storage/transform-cache";

export interface Runtime {
  ctx: AppContext;
  boss: PgBoss | null;
  close(): Promise<void>;
}

export async function createRuntime(
  cfg: Config,
  opts: { service: "api" | "worker"; log?: Logger; queue?: boolean } = { service: "api" },
): Promise<Runtime> {
  const log = opts.log ?? createLogger(cfg.LOG_LEVEL, cfg.NODE_ENV === "development" && process.stdout.isTTY);
  const { pool, db } = createDb(cfg.DATABASE_URL, opts.service === "api" ? 12 : 8);
  const metrics = createMetrics();
  const storage = new LocalStorageDriver(cfg.DATA_DIR);
  const transformCache = new TransformCache(path.join(cfg.DATA_DIR, "cache"), cfg.TRANSFORM_CACHE_BYTES, metrics);
  const transformer = new ImageTransformer(storage, transformCache, metrics);
  const events = new EventBuffer(db, log, metrics);

  let boss: PgBoss | null = null;
  let jobs = noopJobs;
  if (opts.queue !== false) {
    boss = new PgBoss({
      connectionString: cfg.DATABASE_URL,
      max: 4,
      application_name: `bytedrop-${opts.service}`,
      // Only the worker supervises queues and runs the cron schedule.
      supervise: opts.service === "worker",
      schedule: opts.service === "worker",
      registerInstance: false,
      openTelemetry: { enabled: false },
    });
    boss.on("error", (err) => log.error({ err }, "queue error"));
    await boss.start();
    await ensureQueues(boss);
    jobs = createJobs(boss);
  }

  const deliveryMeta = new MetaCache<DeliveryRow | undefined>(cfg.DELIVERY_META_TTL_MS);
  const ctx: AppContext = { cfg, db, pool, log, metrics, storage, transformCache, transformer, events, deliveryMeta, hotFiles: new HotFileCache(cfg.HOT_CACHE_BYTES), jobs };
  events.start();

  return {
    ctx,
    boss,
    async close() {
      await events.stop();
      await boss?.stop({ graceful: true, timeout: 3000 }).catch(() => {});
      await pool.end().catch(() => {});
    },
  };
}
