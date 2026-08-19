import Long from 'long'
import { describe, expect, it } from 'vitest'

import { unsignedLongFromString } from './long'

const uint64Max = '18446744073709551615'
const uint64Overflow = '18446744073709551616'

describe('unsignedLongFromString', () => {
  it('preserves uint64 values above signed int64', () => {
    expect(unsignedLongFromString('9223372036854775808', 'amount').toString()).toBe('9223372036854775808')
    expect(unsignedLongFromString(uint64Max, 'amount').toString()).toBe(uint64Max)
  })

  it('rejects values that long would otherwise wrap', () => {
    expect(Long.fromString(uint64Overflow, true).toString()).toBe('0')
    expect(() => unsignedLongFromString(uint64Overflow, 'amount')).toThrow('amount exceeds uint64')
  })

  it('rejects signed and fractional decimal strings', () => {
    expect(() => unsignedLongFromString('-1', 'amount')).toThrow('amount must be a non-negative integer')
    expect(() => unsignedLongFromString('1.5', 'amount')).toThrow('amount must be a non-negative integer')
  })
})
