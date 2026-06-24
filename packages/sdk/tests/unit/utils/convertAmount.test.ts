import { describe, expect, it } from 'vitest'

import {
  AmountConvertError,
  convertAmount,
  cryptoToFiat,
  fiatToCrypto,
  toBaseUnits,
  toHumanUnits,
} from '../../../src/utils/convertAmount'

describe('convertAmount — base ↔ human', () => {
  describe('toBaseUnits', () => {
    it('scales whole + fractional amounts by 10^decimals', () => {
      expect(toBaseUnits('1.5', 18)).toBe('1500000000000000000')
      expect(toBaseUnits('100', 6)).toBe('100000000')
      expect(toBaseUnits('0.05', 18)).toBe('50000000000000000')
    })

    it('handles decimals=0', () => {
      expect(toBaseUnits('42', 0)).toBe('42')
    })

    it('zero maps to "0"', () => {
      expect(toBaseUnits('0', 18)).toBe('0')
      expect(toBaseUnits('0.0', 18)).toBe('0')
    })

    it('truncates (does NOT round) excess fractional digits', () => {
      // 7 fractional digits on a 6-decimal token — the 7th is dropped.
      expect(toBaseUnits('1.1234567', 6)).toBe('1123456')
    })

    it('preserves precision well beyond Number.MAX_SAFE_INTEGER', () => {
      // 2^53 ≈ 9.007e15 wei; this would corrupt under a float scale.
      expect(toBaseUnits('123456789.123456789', 18)).toBe('123456789123456789000000000')
    })

    it('supports a leading sign', () => {
      expect(toBaseUnits('-1.5', 18)).toBe('-1500000000000000000')
      expect(toBaseUnits('-0', 18)).toBe('0')
    })

    it('rejects scientific notation and junk', () => {
      expect(() => toBaseUnits('1e18', 18)).toThrow(AmountConvertError)
      expect(() => toBaseUnits('abc', 18)).toThrow(AmountConvertError)
      expect(() => toBaseUnits('', 18)).toThrow(AmountConvertError)
      expect(() => toBaseUnits('.', 18)).toThrow(AmountConvertError)
    })

    it('rejects out-of-range decimals', () => {
      expect(() => toBaseUnits('1', -1)).toThrow(AmountConvertError)
      expect(() => toBaseUnits('1', 256)).toThrow(AmountConvertError)
      expect(() => toBaseUnits('1', 1.5)).toThrow(AmountConvertError)
    })
  })

  describe('toHumanUnits', () => {
    it('descales base units by 10^decimals', () => {
      expect(toHumanUnits('1500000000000000000', 18)).toBe('1.5')
      expect(toHumanUnits('100000000', 6)).toBe('100')
      expect(toHumanUnits('50000000000000000', 18)).toBe('0.05')
    })

    it('handles decimals=0', () => {
      expect(toHumanUnits('42', 0)).toBe('42')
    })

    it('renders sub-unit amounts with leading zeros', () => {
      expect(toHumanUnits('1', 18)).toBe('0.000000000000000001')
    })

    it('trims trailing zeros', () => {
      expect(toHumanUnits('1230000', 6)).toBe('1.23')
    })

    it('supports a leading sign', () => {
      expect(toHumanUnits('-1500000000000000000', 18)).toBe('-1.5')
    })

    it('rejects non-integer base-unit strings', () => {
      expect(() => toHumanUnits('1.5', 18)).toThrow(AmountConvertError)
      expect(() => toHumanUnits('', 18)).toThrow(AmountConvertError)
    })

    it('round-trips with toBaseUnits', () => {
      const human = '1234.56789'
      expect(toHumanUnits(toBaseUnits(human, 8), 8)).toBe(human)
    })
  })

  describe('convertAmount dispatcher', () => {
    it('routes to_base / to_human', () => {
      expect(convertAmount({ amount: '1.5', decimals: 18, direction: 'to_base' })).toBe('1500000000000000000')
      expect(convertAmount({ amount: '100000000', decimals: 6, direction: 'to_human' })).toBe('100')
    })
  })
})

describe('convertAmount — fiat ↔ crypto (price as input)', () => {
  it('fiatToCrypto: $100 of ETH @ $2000 = 0.05 ETH', () => {
    expect(fiatToCrypto({ fiatValue: 100, price: 2000, decimals: 18 })).toBe('0.05')
  })

  it('fiatToCrypto: accepts numeric strings', () => {
    expect(fiatToCrypto({ fiatValue: '50', price: '1', decimals: 6 })).toBe('50')
  })

  it('cryptoToFiat: 0.05 ETH @ $2000 = $100', () => {
    expect(cryptoToFiat({ amount: 0.05, price: 2000 })).toBe('100')
  })

  it('cryptoToFiat: caps to fiat decimals (default cents)', () => {
    expect(cryptoToFiat({ amount: 1.23456, price: 1 })).toBe('1.23')
    expect(cryptoToFiat({ amount: 1.23456, price: 1, fiatDecimals: 4 })).toBe('1.2345')
  })

  it('round-trips fiat → crypto → fiat', () => {
    const crypto = fiatToCrypto({ fiatValue: 100, price: 2000, decimals: 18 })
    expect(cryptoToFiat({ amount: crypto, price: 2000 })).toBe('100')
  })

  it('rejects non-positive fiat / price / amount', () => {
    expect(() => fiatToCrypto({ fiatValue: 0, price: 2000, decimals: 18 })).toThrow(AmountConvertError)
    expect(() => fiatToCrypto({ fiatValue: 100, price: -1, decimals: 18 })).toThrow(AmountConvertError)
    expect(() => cryptoToFiat({ amount: 'nope', price: 2000 })).toThrow(AmountConvertError)
  })

  // Regression: large results (>=1e21) take the scientific-notation code path.
  // Node's Number.toFixed() ALSO emits exponential form at/above 1e21, so the
  // old toFixed-then-split formatter leaked "1e+21" or truncated 1.5e21 → "1"
  // (off by 21 orders of magnitude). This is the canonical amount-rendering
  // primitive at the signing boundary — a silent 10^21 truncation is fund-relevant.
  it('cryptoToFiat: large values never leak scientific notation', () => {
    expect(cryptoToFiat({ amount: 1e21, price: 1, fiatDecimals: 2 })).toBe('1000000000000000000000')
    expect(cryptoToFiat({ amount: 1.5e21, price: 1, fiatDecimals: 0 })).toBe('1500000000000000000000')
    expect(cryptoToFiat({ amount: 1.5e21, price: 1, fiatDecimals: 2 })).toBe('1500000000000000000000')
    expect(cryptoToFiat({ amount: 1e30, price: 1, fiatDecimals: 2 })).toBe('1000000000000000000000000000000')
  })

  it('fiatToCrypto: large results never leak scientific notation', () => {
    expect(fiatToCrypto({ fiatValue: 1e21, price: 1, decimals: 18 })).toBe('1000000000000000000000')
    expect(fiatToCrypto({ fiatValue: 1e24, price: 1000, decimals: 18 })).toBe('1000000000000000000000')
  })

  it('handles small (sub-1e-6) values that toString() renders in sci notation', () => {
    expect(cryptoToFiat({ amount: 1e-7, price: 1, fiatDecimals: 18 })).toBe('0.0000001')
    expect(fiatToCrypto({ fiatValue: 1, price: 1e9, decimals: 18 })).toBe('0.000000001')
    expect(fiatToCrypto({ fiatValue: 1e-10, price: 1, decimals: 18 })).toBe('0.0000000001')
  })

  it('truncates (does not round) the capped fractional part, consistently across magnitudes', () => {
    expect(cryptoToFiat({ amount: '0.999', price: 1 })).toBe('0.99')
    expect(fiatToCrypto({ fiatValue: 1, price: 3, decimals: 8 })).toBe('0.33333333')
    // sci-path small value also truncates rather than rounding up
    expect(cryptoToFiat({ amount: 9e-7, price: 1, fiatDecimals: 2 })).toBe('0')
  })
})
