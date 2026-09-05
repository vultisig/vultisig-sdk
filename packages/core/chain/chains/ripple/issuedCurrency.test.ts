import { describe, expect, it } from 'vitest'

import {
  formatIssuedCurrencyValue,
  getSignableIssuedCurrencyAmount,
  parseIssuedCurrencyValue,
  rippleIssuedCurrencyDecimals,
} from './issuedCurrency'

describe('getSignableIssuedCurrencyAmount', () => {
  const token = {
    currency: 'RLUSD',
    issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
    decimals: 15,
  }

  it('preserves an exactly representable 16-digit quantity', () => {
    expect(
      getSignableIssuedCurrencyAmount({
        ...token,
        amount: 1_234_567_890_123_456n,
      }).value
    ).toBe('1.234567890123456')
  })

  it('rejects a 17-digit quantity instead of silently rounding it', () => {
    expect(() =>
      getSignableIssuedCurrencyAmount({
        ...token,
        amount: 12_345_678_901_234_567n,
      })
    ).toThrow(/16 significant digits/)
  })

  it('does not count trailing zeros as significant digits', () => {
    expect(
      getSignableIssuedCurrencyAmount({
        ...token,
        amount: 12_345_678_901_234_560n,
      }).value
    ).toBe('12.34567890123456')
  })

  it.each(['usd', 'XRP', '0'.repeat(40), '0000000000000000000000005852500000000000', '€€€'])(
    'rejects unsafe currency %s',
    currency => {
      expect(() => getSignableIssuedCurrencyAmount({ ...token, currency, amount: 1n })).toThrow(/currency code/)
    }
  )

  it.each([-1, 1.5, 97, NaN])('rejects unsupported decimal scale %s', decimals => {
    expect(() => getSignableIssuedCurrencyAmount({ ...token, decimals, amount: 1n })).toThrow(/decimal scale/)
  })

  it('bounds the XRPL exponent range without rounding underflow to zero', () => {
    expect(getSignableIssuedCurrencyAmount({ ...token, decimals: 81, amount: 1n }).value).toBe(`0.${'0'.repeat(80)}1`)
    expect(() => getSignableIssuedCurrencyAmount({ ...token, decimals: 82, amount: 1n })).toThrow(/representable/)
    expect(() =>
      getSignableIssuedCurrencyAmount({
        ...token,
        decimals: 0,
        amount: 10n ** 96n,
      })
    ).toThrow(/representable/)
  })

  it('permits a zero TrustSet limit but rejects negative amounts and invalid issuers', () => {
    expect(getSignableIssuedCurrencyAmount({ ...token, amount: 0n }).value).toBe('0')
    expect(() => getSignableIssuedCurrencyAmount({ ...token, amount: -1n })).toThrow(/amount/)
    expect(() =>
      getSignableIssuedCurrencyAmount({
        ...token,
        amount: 1n,
        issuer: 'rInvalid',
      })
    ).toThrow(/issuer/)
  })

  it('rejects sparse high-exponent quantities unsupported by WalletCore', () => {
    expect(getSignableIssuedCurrencyAmount({ ...token, decimals: 0, amount: 10n ** 80n }).value).toBe(
      `1${'0'.repeat(80)}`
    )
    expect(() => getSignableIssuedCurrencyAmount({ ...token, decimals: 0, amount: 10n ** 81n })).toThrow(
      /signer exponent/
    )
    expect(() => getSignableIssuedCurrencyAmount({ ...token, decimals: 0, amount: 10n ** 95n })).toThrow(
      /signer exponent/
    )
    expect(
      getSignableIssuedCurrencyAmount({ ...token, decimals: 0, amount: 9_999_999_999_999_999n * 10n ** 80n }).value
    ).toBe(`9999999999999999${'0'.repeat(80)}`)
  })
})

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
