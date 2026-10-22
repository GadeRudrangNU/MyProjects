/**
 * In-memory LRU for small, frequently requested files. Opening a file per request is the dominant cost of serving
 * small assets, so anything under `maxItemBytes` is read once and served from memory until evicted. Entries are keyed by
 * content hash (or transform key), which never change, so there is nothing to invalidate.
 */
export class HotFileCache {
  private readonly entries = new Map<string, Buffer>();
  private readonly inflight = new Map<string, Promise<Buffer>>();
  private bytes = 0;
  hits = 0;
  misses = 0;

  constructor(
    private readonly maxBytes: number,
    readonly maxItemBytes = 512 * 1024,
  ) {}

  get enabled() {
    return this.maxBytes > 0;
  }

  get size() {
    return this.bytes;
  }

  async get(key: string, load: () => Promise<Buffer>): Promise<Buffer> {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      this.hits++;
      return hit;
    }
    const running = this.inflight.get(key);
    if (running) return running;
    this.misses++;
    const promise = load()
      .then((buf) => {
        this.add(key, buf);
        return buf;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private add(key: string, buf: Buffer) {
    if (buf.length > this.maxItemBytes) return;
    this.entries.set(key, buf);
    this.bytes += buf.length;
    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.entries.get(oldest)!.length;
      this.entries.delete(oldest);
    }
  }
}
