import { describe, expect, it } from 'vitest'

import { bigIntToHex } from './bigIntToHex'

describe('bigIntToHex', () => {
  it.each([-1n, -256n, -(1n << 128n)])('rejects negative input %s', value => {
    expect(() => bigIntToHex(value)).toThrow(RangeError)
  })

  it.each([
    [0n, '00'],
    [1n, '01'],
    [15n, '0f'],
    [256n, '0100'],
    [(1n << 128n) - 1n, 'ff'.repeat(16)],
  ] as const)('preserves unsigned encoding for %s', (value, expected) => {
    expect(bigIntToHex(value)).toBe(expected)
  })
})
