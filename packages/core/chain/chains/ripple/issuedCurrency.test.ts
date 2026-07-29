import { describe, expect, it } from 'vitest'

import { formatIssuedCurrencyValue, parseIssuedCurrencyValue, rippleIssuedCurrencyDecimals } from './issuedCurrency'

describe('parseIssuedCurrencyValue', () => {
  it('scales a whole number to base units', () => {
    expect(parseIssuedCurrencyValue('12')).toBe(12_000_000_000_000_000n)
  })

  it('scales a decimal to base units', () => {
    expect(parseIssuedCurrencyValue('12.5')).toBe(12_500_000_000_000_000n)
  })

  it('keeps full precision for a dust balance a float would corrupt', () => {
    expect(parseIssuedCurrencyValue('0.00204230364')).toBe(2_042_303_640_000n)
  })

  it('parses scientific notation, which the ledger may return', () => {
    expect(parseIssuedCurrencyValue('1e-8')).toBe(10_000_000n)
    expect(parseIssuedCurrencyValue('1.5E3')).toBe(1_500_000_000_000_000_000n)
  })

  it('preserves the sign of an issued (negative) line', () => {
    expect(parseIssuedCurrencyValue('-42')).toBe(-42_000_000_000_000_000n)
  })

  it('truncates rather than rounds beyond the modelled precision', () => {
    // 16 fractional digits — the last is below our precision and must be dropped,
    // never rounded up into a larger holding.
    expect(parseIssuedCurrencyValue('0.0000000000000009')).toBe(0n)
  })

  it('rejects a malformed value instead of silently reading as zero', () => {
    expect(() => parseIssuedCurrencyValue('not-a-number')).toThrow(/Invalid XRPL issued-currency value/)
  })

  it('round-trips with formatIssuedCurrencyValue', () => {
    const values = ['0', '1', '12.5', '0.00204230364', '-42']

    values.forEach(value => {
      const parsed = parseIssuedCurrencyValue(value)

      expect(formatIssuedCurrencyValue(parsed, rippleIssuedCurrencyDecimals)).toBe(value)
    })
  })
})
