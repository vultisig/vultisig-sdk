import Long from 'long'
import { describe, expect, it } from 'vitest'

import { numberToEvenHex } from './numberToHex'

describe('numberToEvenHex', () => {
  it('encodes a positive number / bigint / Long to even-length hex', () => {
    expect(numberToEvenHex(255)).toBe('ff')
    expect(numberToEvenHex(256n)).toBe('0100')
    expect(numberToEvenHex(Long.fromNumber(1))).toBe('01')
  })

  it('throws on a negative number', () => {
    expect(() => numberToEvenHex(-1)).toThrow(RangeError)
    expect(() => numberToEvenHex(-255)).toThrow(/negative value/)
  })

  it('throws on a negative bigint', () => {
    expect((-1n).toString(16)).toBe('-1')
    expect(() => numberToEvenHex(-1n)).toThrow(RangeError)
  })

  it('throws on a negative Long', () => {
    expect(() => numberToEvenHex(Long.fromNumber(-1))).toThrow(RangeError)
  })
})
