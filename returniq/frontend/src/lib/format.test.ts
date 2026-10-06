import { describe, expect, it } from 'vitest'
import { gbp, gbpCompact, pct } from './format'

describe('format helpers', () => {
  it('formats percentages and missing values', () => {
    expect(pct(0.01587)).toBe('1.6%')
    expect(pct(null)).toBe('—')
    expect(pct(NaN)).toBe('—')
  })
  it('formats currency with a proper minus sign', () => {
    expect(gbp(1234.5)).toBe('£1,235')
    expect(gbp(-50)).toBe('−£50')
  })
  it('compacts large currency values', () => {
    expect(gbpCompact(2_500_000)).toBe('£2.5M')
    expect(gbpCompact(12_300)).toBe('£12.3k')
  })
})
