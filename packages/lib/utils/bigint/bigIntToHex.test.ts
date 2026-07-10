import { describe, expect, it } from 'vitest'

import { bigIntToHex } from './bigIntToHex'

describe('bigIntToHex', () => {
  it('encodes a positive value to even-length hex', () => {
    expect(bigIntToHex(0n)).toBe('00')
    expect(bigIntToHex(255n)).toBe('ff')
    expect(bigIntToHex(256n)).toBe('0100')
    // Odd nibble count is left-padded to a whole byte.
    expect(bigIntToHex(1n)).toBe('01')
  })

  it('throws on a negative value instead of emitting a "-"-prefixed string', () => {
    // Raw `.toString(16)` would yield "-1", which `Buffer.from(hex, 'hex')`
    // silently turns into empty/garbage bytes.
    expect((-1n).toString(16)).toBe('-1')
    expect(() => bigIntToHex(-1n)).toThrow(RangeError)
    expect(() => bigIntToHex(-255n)).toThrow(/negative value/)
  })
})
