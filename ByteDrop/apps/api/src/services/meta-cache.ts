/**
 * Short-lived cache and request collapsing for the delivery lookup (bucket + object row).
 *
 * Hot files are requested many times a second; this keeps them off the database. Writes made through this process
 * invalidate immediately, so within one instance a new upload or delete is visible at once. Other instances see a change
 * after at most `ttlMs`.
 */
export class MetaCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();
  private readonly inflight = new Map<string, Promise<V>>();
  /** Bumped by invalidations so a lookup that started before a write cannot repopulate the cache with stale data. */
  private generation = 0;
  hits = 0;
  misses = 0;
  collapsed = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 5000,
    private readonly now: () => number = Date.now,
  ) {}

  private static key(bucket: string, objectKey: string) {
    return `${bucket}\n${objectKey}`;
  }

  async lookup(bucket: string, objectKey: string, load: () => Promise<V>): Promise<V> {
    if (this.ttlMs <= 0) return load();
    const key = MetaCache.key(bucket, objectKey);
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) {
      this.hits++;
      return hit.value;
    }
    const running = this.inflight.get(key);
    if (running) {
      this.collapsed++;
      return running;
    }
    this.misses++;
    const started = this.generation;
    const promise = load()
      .then((value) => {
        if (started === this.generation) this.store(key, value);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private store(key: string, value: V) {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
  }

  invalidate(bucket: string, objectKey: string) {
    this.generation++;
    const key = MetaCache.key(bucket, objectKey);
    this.entries.delete(key);
    this.inflight.delete(key);
  }

  invalidateBucket(bucket: string) {
    this.generation++;
    const prefix = `${bucket}\n`;
    for (const k of this.entries.keys()) if (k.startsWith(prefix)) this.entries.delete(k);
    for (const k of this.inflight.keys()) if (k.startsWith(prefix)) this.inflight.delete(k);
  }
}
