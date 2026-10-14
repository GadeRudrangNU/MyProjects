export class RingBuffer<T> {
  private items: T[]
  private start = 0
  private size = 0

  constructor(readonly capacity: number) {
    this.items = new Array<T>(capacity)
  }

  push(item: T) {
    const end = (this.start + this.size) % this.capacity
    this.items[end] = item
    if (this.size < this.capacity) this.size++
    else this.start = (this.start + 1) % this.capacity
  }

  get length() {
    return this.size
  }

  toArray(): T[] {
    const out: T[] = []
    for (let i = 0; i < this.size; i++) out.push(this.items[(this.start + i) % this.capacity])
    return out
  }

  clear() {
    this.start = 0
    this.size = 0
  }
}
