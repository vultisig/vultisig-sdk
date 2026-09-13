import { describe, expect, it } from 'vitest'

import { isPlainKaminoDecimal, parseKaminoDisplayDecimal } from './decimal'

describe('isPlainKaminoDecimal', () => {
  it('accepts plain and negative values', () => {
    expect(isPlainKaminoDecimal('0')).toBe(true)
    expect(isPlainKaminoDecimal('100000')).toBe(true)
    expect(isPlainKaminoDecimal('-17064.57')).toBe(true)
    expect(isPlainKaminoDecimal('0.03994268764493801732')).toBe(true)
  })

  it('rejects formatting rather than coercing it', () => {
    // grouping separators must be rejected
    expect(isPlainKaminoDecimal('1,053.60')).toBe(false)
    // exponent notation must be rejected
    expect(isPlainKaminoDecimal('1e-5')).toBe(false)
    // whitespace must be rejected
    expect(isPlainKaminoDecimal(' 1.5')).toBe(false)
    // a second separator must be rejected
    expect(isPlainKaminoDecimal('1.5.5')).toBe(false)
    // a bare separator has no digits
    expect(isPlainKaminoDecimal('.')).toBe(false)
    expect(isPlainKaminoDecimal('abc')).toBe(false)
    expect(isPlainKaminoDecimal('')).toBe(false)
    // a sign anywhere but the front must be rejected
    expect(isPlainKaminoDecimal('1-5')).toBe(false)
    // non-ASCII digits must be rejected, not normalized
    expect(isPlainKaminoDecimal('١٢٣')).toBe(false)
  })
})

describe('parseKaminoDisplayDecimal', () => {
  it('parses validated values', () => {
    expect(parseKaminoDisplayDecimal('0.0391')).toBe(0.0391)
    expect(parseKaminoDisplayDecimal('-17064.57')).toBe(-17064.57)
    expect(parseKaminoDisplayDecimal('100000')).toBe(100000)
  })

  it('refuses what the validator refuses instead of coercing', () => {
    // Number('1,053.60') would be NaN, but Number('') is 0 and Number(' 1.5')
    // is 1.5 — the strict validator is what keeps these out.
    expect(parseKaminoDisplayDecimal('')).toBeUndefined()
    expect(parseKaminoDisplayDecimal(' 1.5')).toBeUndefined()
    expect(parseKaminoDisplayDecimal('1,053.60')).toBeUndefined()
    expect(parseKaminoDisplayDecimal('1e-5')).toBeUndefined()
  })
})
