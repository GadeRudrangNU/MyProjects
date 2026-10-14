import { percentile } from './percentile'

describe('percentile (nearest rank)', () => {
  it('matches the nearest-rank definition', () => {
    const data = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(percentile(data, 95)).toBe(19)
    expect(percentile(data, 100)).toBe(20)
    expect(percentile([5, 1, 3], 50)).toBe(3)
  })

  it('returns null for no data', () => {
    expect(percentile([], 50)).toBeNull()
  })
})
