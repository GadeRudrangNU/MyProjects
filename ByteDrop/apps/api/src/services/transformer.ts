import { statSync } from "node:fs";
import sharp from "sharp";
import type { ImageFormat, TransformParams } from "@bytedrop/shared";
import type { Metrics } from "../metrics";
import type { StorageDriver } from "../storage/driver";
import type { TransformCache } from "../storage/transform-cache";

export interface TransformResult {
  key: string;
  path: string;
  size: number;
  contentType: string;
  state: "HIT" | "MISS";
  coalesced: boolean;
}

const MIME: Record<ImageFormat, string> = {
  webp: "image/webp",
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
};

function formatFromMime(mime: string): ImageFormat {
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/png") return "png";
  if (mime === "image/avif") return "avif";
  return "webp";
}

class Semaphore {
  private waiting: Array<() => void> = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export class ImageTransformer {
  private readonly inflight = new Map<string, Promise<TransformResult>>();
  private readonly gate = new Semaphore(4);
  /** Number of times an image was actually processed (not served from cache or coalesced). */
  processed = 0;

  constructor(
    private readonly storage: StorageDriver,
    private readonly cache: TransformCache,
    private readonly metrics?: Metrics,
  ) {}

  static isTransformRequest(p: Partial<TransformParams> & { w?: number; h?: number; format?: string }) {
    return Boolean(p.w || p.h || p.format);
  }

  keyFor(blobHash: string, sourceMime: string, p: TransformParams) {
    const fmt = p.format ?? formatFromMime(sourceMime);
    return `${blobHash.slice(0, 32)}_${p.w ?? 0}x${p.h ?? 0}_q${p.q}_${p.fit}.${fmt}`;
  }

  async get(blobHash: string, sourceMime: string, p: TransformParams): Promise<TransformResult> {
    const fmt = p.format ?? formatFromMime(sourceMime);
    const key = this.keyFor(blobHash, sourceMime, p);
    const contentType = MIME[fmt];

    const follow = async (running: Promise<TransformResult>) => {
      this.metrics?.cacheEvents.inc({ layer: "transform", result: "coalesced" });
      return { ...(await running), state: "HIT" as const, coalesced: true };
    };
    const hit = () => {
      this.metrics?.cacheEvents.inc({ layer: "transform", result: "hit" });
      return this.result(key, contentType, "HIT", false);
    };

    const early = this.inflight.get(key);
    if (early) return follow(early);
    const cached = await this.cache.has(key);
    // Another request may have started (or finished) the same work while we awaited the disk check.
    const raced = this.inflight.get(key);
    if (raced) return follow(raced);
    if (cached || this.cache.peek(key)) return hit();

    const job = this.gate
      .run(async () => {
        this.processed++;
        const out = await sharp(this.storage.localPath(blobHash), { failOn: "none" })
          .rotate()
          .resize({ width: p.w, height: p.h, fit: p.fit, withoutEnlargement: true })
          .toFormat(fmt, { quality: p.q })
          .toBuffer();
        await this.cache.put(key, out);
        return this.result(key, contentType, "MISS", false, out.length);
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    this.metrics?.cacheEvents.inc({ layer: "transform", result: "miss" });
    return job;
  }

  private result(
    key: string,
    contentType: string,
    state: "HIT" | "MISS",
    coalesced: boolean,
    size?: number,
  ): TransformResult {
    return { key, path: this.cache.pathFor(key), size: size ?? this.sizeOf(key), contentType, state, coalesced };
  }

  private sizeOf(key: string) {
    return statSync(this.cache.pathFor(key)).size;
  }
}
