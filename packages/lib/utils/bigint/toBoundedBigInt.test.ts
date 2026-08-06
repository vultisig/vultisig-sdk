import { describe, expect, it } from 'vitest'

import { toBoundedBigInt } from './toBoundedBigInt'

const U64_MAX = 2n ** 64n - 1n
const U128_MAX = 2n ** 128n - 1n
const U256_MAX = 2n ** 256n - 1n

describe('toBoundedBigInt', () => {
  it('parses in-range values for each supported width', () => {
    expect(toBoundedBigInt('123456789', { bits: 64, signed: false })).toBe(123456789n)
    expect(toBoundedBigInt(U64_MAX, { bits: 64, signed: false })).toBe(U64_MAX)
    expect(toBoundedBigInt(U128_MAX, { bits: 128, signed: false })).toBe(U128_MAX)
    expect(toBoundedBigInt(U256_MAX, { bits: 256, signed: false })).toBe(U256_MAX)
  })

  it('rejects values above the requested width', () => {
    expect(() => toBoundedBigInt(U64_MAX + 1n, { bits: 64, signed: false })).toThrow(RangeError)
    expect(() => toBoundedBigInt(U128_MAX + 1n, { bits: 128, signed: false })).toThrow(RangeError)
    expect(() => toBoundedBigInt(U256_MAX + 1n, { bits: 256, signed: false })).toThrow(RangeError)
  })

  it('respects signedness bounds', () => {
    expect(toBoundedBigInt(-(2n ** 63n), { bits: 64, signed: true })).toBe(-(2n ** 63n))
    expect(() => toBoundedBigInt(2n ** 63n, { bits: 64, signed: true })).toThrow(RangeError)
    expect(() => toBoundedBigInt(-1n, { bits: 64, signed: false })).toThrow(RangeError)
  })

  it("rejects '' instead of the BigInt('') -> 0n fail-open", () => {
    expect(BigInt('')).toBe(0n)
    expect(() => toBoundedBigInt('', { bits: 64, signed: false })).toThrow(RangeError)
    expect(() => toBoundedBigInt('', { bits: 256, signed: false })).toThrow(RangeError)
  })

  it('rejects non-decimal-integer strings that bare BigInt() would accept', () => {
    for (const bad of ['0x10', ' 42', '42 ', '4_2', '1e3', '']) {
      expect(() => toBoundedBigInt(bad, { bits: 64, signed: false })).toThrow(RangeError)
    }
  })
})
