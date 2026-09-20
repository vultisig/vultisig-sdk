import { describe, expect, expectTypeOf, it } from 'vitest'

import { clampThenUniformScalar as canonicalClampThenUniformScalar } from '../../../src/crypto/ed25519ScalarClamp'
import { clampThenUniformScalar } from '../../../src/index'

const zeroSeedExpected = [
  175, 34, 224, 240, 87, 185, 220, 205, 75, 27, 229, 206, 119, 226, 231, 213, 87, 181, 121, 112, 181, 38, 122, 144, 245,
  121, 96, 146, 74, 135, 241, 6,
]

describe('Ed25519 scalar clamp root export', () => {
  it('exports the canonical helper with its public signature', () => {
    expect(clampThenUniformScalar).toBe(canonicalClampThenUniformScalar)
    expectTypeOf(clampThenUniformScalar).toEqualTypeOf<(seed: Uint8Array) => Uint8Array>()
  })

  it('preserves canonical output, input immutability, and length validation', () => {
    const seed = new Uint8Array(32)
    const original = seed.slice()

    expect(Array.from(clampThenUniformScalar(seed))).toEqual(zeroSeedExpected)
    expect(seed).toEqual(original)
    expect(() => clampThenUniformScalar(new Uint8Array(31))).toThrow('Seed must be 32 bytes')
    expect(() => clampThenUniformScalar(new Uint8Array(33))).toThrow('Seed must be 32 bytes')
  })
})
