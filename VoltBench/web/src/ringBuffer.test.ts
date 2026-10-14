import { RingBuffer } from './ringBuffer'

describe('RingBuffer', () => {
  it('keeps items in insertion order below capacity', () => {
    const rb = new RingBuffer<number>(5)
    ;[1, 2, 3].forEach((n) => rb.push(n))
    expect(rb.toArray()).toEqual([1, 2, 3])
    expect(rb.length).toBe(3)
  })

  it('never grows past capacity and drops the oldest', () => {
    const rb = new RingBuffer<number>(3)
    for (let i = 1; i <= 10; i++) rb.push(i)
    expect(rb.length).toBe(3)
    expect(rb.toArray()).toEqual([8, 9, 10])
  })

  it('can be cleared and reused', () => {
    const rb = new RingBuffer<string>(2)
    rb.push('a')
    rb.push('b')
    rb.push('c')
    rb.clear()
    expect(rb.toArray()).toEqual([])
    rb.push('d')
    expect(rb.toArray()).toEqual(['d'])
  })
})
