import { describe, expect, it } from 'vitest'

import { bigIntToHex } from './bigIntToHex'

describe('bigIntToHex', () => {
  it('returns even-length hex for non-negative values', () => {
    expect(bigIntToHex(0n)).toBe('00')
    expect(bigIntToHex(10n)).toBe('0a')
    expect(bigIntToHex(255n)).toBe('ff')
  })

  it('rejects negative values before hex decoding can silently produce empty bytes', () => {
    expect(() => bigIntToHex(-1n)).toThrow('bigIntToHex: value must be non-negative')
  })
})
