import Long from 'long'
import { describe, expect, it } from 'vitest'

import { numberToEvenHex } from './numberToHex'

describe('numberToEvenHex', () => {
  it('returns even-length hex for supported non-negative numeric inputs', () => {
    expect(numberToEvenHex(0)).toBe('00')
    expect(numberToEvenHex(10)).toBe('0a')
    expect(numberToEvenHex(255n)).toBe('ff')
    expect(numberToEvenHex(Long.fromNumber(16))).toBe('10')
  })

  it('rejects negative values before hex decoding can silently produce empty bytes', () => {
    expect(() => numberToEvenHex(-1)).toThrow('numberToEvenHex: amount must be non-negative')
    expect(() => numberToEvenHex(-1n)).toThrow('numberToEvenHex: amount must be non-negative')
    expect(() => numberToEvenHex(Long.fromNumber(-1))).toThrow('numberToEvenHex: amount must be non-negative')
  })
})
