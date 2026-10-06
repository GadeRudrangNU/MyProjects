export const IDLE_LIMIT_MS = 60_000
export const MIN_FLUSH_SECONDS = 3

export class ActiveTimeCounter {
  private pending = 0
  private lastInteraction: number
  visible = true
  constructor(now: number) { this.lastInteraction = now }

  interact(now: number) { this.lastInteraction = now }

  tick(now: number): boolean {
    if (!this.visible || now - this.lastInteraction > IDLE_LIMIT_MS) return false
    this.pending += 1
    return true
  }

  get pendingSeconds() { return this.pending }

  take(final = false): number {
    if (this.pending < MIN_FLUSH_SECONDS) {
      if (final) this.pending = 0
      return 0
    }
    const n = this.pending
    this.pending = 0
    return n
  }
}
