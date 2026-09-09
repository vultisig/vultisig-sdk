import { describe, expect, it } from 'vitest'

import { toEvmTwAmount } from './toEvmTwAmount'

describe('toEvmTwAmount', () => {
  it.each([-1n, -256n, -1, '-256'])('rejects negative amount %s before producing bytes', amount => {
    expect(() => toEvmTwAmount(amount)).toThrow(RangeError)
  })

  it.each([
    [0n, '00'],
    [-0, '00'],
    ['1', '01'],
    [256, '0100'],
    [(1n << 256n) - 1n, 'ff'.repeat(32)],
  ] as const)('preserves amount bytes for %s', (amount, expected) => {
    expect(toEvmTwAmount(amount).toString('hex')).toBe(expected)
  })
})
