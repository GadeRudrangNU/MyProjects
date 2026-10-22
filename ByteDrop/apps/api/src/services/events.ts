import type { Logger } from "pino";
import type { Db } from "../db/client";
import { deliveryEvents } from "../db/schema";
import type { Metrics } from "../metrics";

export interface DeliveryEvent {
  projectId: string;
  bucketId: string;
  bucket: string;
  objectKey: string;
  kind: string;
  status: number;
  bytes: number;
  cache: "HIT" | "MISS" | "REVALIDATED" | "BYPASS";
  latencyMs: number;
  referrer: string | null;
  createdAt?: Date;
}

/** Buffers delivery events in memory and writes them to Postgres in batches. */
export class EventBuffer {
  private buf: DeliveryEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly metrics?: Metrics,
    private readonly intervalMs = 1000,
    private readonly maxBatch = 500,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    this.timer.unref();
  }

  push(e: DeliveryEvent) {
    this.buf.push({ ...e, createdAt: e.createdAt ?? new Date() });
    this.metrics?.analyticsBuffered.set(this.buf.length);
    if (this.buf.length >= this.maxBatch) void this.flush();
  }

  flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      while (this.buf.length) {
        const batch = this.buf.splice(0, 1000);
        this.metrics?.analyticsBuffered.set(this.buf.length);
        try {
          await this.db.insert(deliveryEvents).values(batch);
        } catch (err) {
          this.log.error({ err, dropped: batch.length }, "failed to flush delivery events");
        }
      }
    });
    return this.flushing;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}
