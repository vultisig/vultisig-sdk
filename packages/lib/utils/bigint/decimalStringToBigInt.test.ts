import { describe, expect, it } from 'vitest'

import { decimalStringToBigInt } from './decimalStringToBigInt'

describe('decimalStringToBigInt', () => {
  it('parses integers and trims whitespace', () => {
    expect(decimalStringToBigInt(' 42 ', 0)).toBe(42n)
    expect(decimalStringToBigInt('0', 4)).toBe(0n)
  })

  it('pads or truncates fractional digits to the given scale', () => {
    expect(decimalStringToBigInt('1.2', 4)).toBe(12_000n)
    expect(decimalStringToBigInt('3.14', 2)).toBe(314n)
  })

  it('handles negative values', () => {
    expect(decimalStringToBigInt('-1.5', 1)).toBe(-15n)
  })

  it('rejects empty, dot-only, and over-precision inputs', () => {
    expect(() => decimalStringToBigInt('', 2)).toThrow('Invalid decimal string')
    expect(() => decimalStringToBigInt('.', 2)).toThrow('Invalid decimal string')
    expect(() => decimalStringToBigInt('1.001', 2)).toThrow(
      /^Fractional part exceeds 2 decimals: \d+$/
    )
  })

  it('rejects non-digit integer parts', () => {
    expect(() => decimalStringToBigInt('12a.0', 2)).toThrow('Invalid decimal string: 12a.0')
  })
})
