import type { Logger } from "pino";
import type { Config } from "./config";
import type { Db } from "./db/client";
import type { buckets, objects } from "./db/schema";
import type { Jobs } from "./jobs/queues";
import type { Metrics } from "./metrics";
import type { EventBuffer } from "./services/events";
import type { HotFileCache } from "./services/hot-cache";
import type { MetaCache } from "./services/meta-cache";
import type { ImageTransformer } from "./services/transformer";
import type { StorageDriver } from "./storage/driver";
import type { TransformCache } from "./storage/transform-cache";
import type pg from "pg";

export type DeliveryRow = {
  bucket: typeof buckets.$inferSelect;
  object: typeof objects.$inferSelect | null;
};

export interface AppContext {
  cfg: Config;
  db: Db;
  pool: pg.Pool;
  log: Logger;
  metrics: Metrics;
  storage: StorageDriver;
  transformCache: TransformCache;
  transformer: ImageTransformer;
  events: EventBuffer;
  deliveryMeta: MetaCache<DeliveryRow | undefined>;
  hotFiles: HotFileCache;
  jobs: Jobs;
}
