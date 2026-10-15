import { describe, expect, it } from 'vitest'
import { challengeFor, randomString } from './pkce'

describe('pkce', () => {
  it('derives the S256 challenge from the RFC 7636 example', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('creates url safe verifiers long enough for the spec', () => {
    const verifier = randomString()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(randomString()).not.toBe(verifier)
  })
})
