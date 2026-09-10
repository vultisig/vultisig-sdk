import Long from 'long'
import { describe, expect, it } from 'vitest'

import { numberToEvenHex } from './numberToHex'

describe('numberToEvenHex', () => {
  it.each([-1, -256, -0.5, -1n, -256n, Long.NEG_ONE, Long.MIN_VALUE])('rejects negative input %s', amount => {
    expect(() => numberToEvenHex(amount)).toThrow(RangeError)
  })

  it.each([
    [0, '00'],
    [-0, '00'],
    [0n, '00'],
    [1, '01'],
    [256n, '0100'],
    [Long.ZERO, '00'],
    [Long.UZERO, '00'],
    [Long.fromInt(256), '0100'],
    [Long.MAX_VALUE, '7fffffffffffffff'],
    [Long.MAX_UNSIGNED_VALUE, 'ffffffffffffffff'],
    [1n << 128n, '01' + '00'.repeat(16)],
  ] as const)('preserves unsigned encoding for %s', (amount, expected) => {
    expect(numberToEvenHex(amount)).toBe(expected)
  })
})
