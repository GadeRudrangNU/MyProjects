import { mkdirSync, readdirSync, statSync } from "node:fs";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Metrics } from "../metrics";

interface Entry {
  size: number;
}

/** On-disk LRU for transformed images. Entries are immutable and keyed by content hash plus parameters. */
export class TransformCache {
  private readonly index = new Map<string, Entry>();
  private total = 0;

  constructor(
    private readonly dir: string,
    private readonly maxBytes: number,
    private readonly metrics?: Metrics,
  ) {
    mkdirSync(dir, { recursive: true });
    const files = readdirSync(dir)
      .filter((f) => !f.endsWith(".tmp"))
      .map((f) => ({ f, st: statSync(path.join(dir, f)) }))
      .sort((a, b) => a.st.mtimeMs - b.st.mtimeMs);
    for (const { f, st } of files) this.track(f, st.size);
    this.report();
  }

  private track(key: string, size: number) {
    const prev = this.index.get(key);
    if (prev) this.total -= prev.size;
    this.index.delete(key);
    this.index.set(key, { size });
    this.total += size;
  }

  private report() {
    this.metrics?.transformCacheBytes.set(this.total);
  }

  pathFor(key: string) {
    return path.join(this.dir, key);
  }

  get entries() {
    return this.index.size;
  }

  get bytes() {
    return this.total;
  }

  peek(key: string) {
    return this.index.has(key);
  }

  async has(key: string): Promise<boolean> {
    const hit = this.index.get(key);
    if (hit) {
      this.index.delete(key);
      this.index.set(key, hit);
      return true;
    }
    // Written by another process (the worker warms thumbnails into the same directory).
    try {
      const st = await stat(this.pathFor(key));
      this.track(key, st.size);
      return true;
    } catch {
      return false;
    }
  }

  async put(key: string, data: Buffer) {
    const tmp = path.join(this.dir, `${randomUUID()}.tmp`);
    await writeFile(tmp, data);
    await rename(tmp, this.pathFor(key));
    this.track(key, data.length);
    await this.evict(key);
    this.report();
  }

  private async evict(keep: string) {
    while (this.total > this.maxBytes && this.index.size > 1) {
      const oldest = this.index.keys().next().value as string;
      if (oldest === keep) break;
      const entry = this.index.get(oldest)!;
      this.index.delete(oldest);
      this.total -= entry.size;
      await rm(this.pathFor(oldest), { force: true });
    }
  }
}
