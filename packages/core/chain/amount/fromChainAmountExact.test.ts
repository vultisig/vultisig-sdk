import { describe, expect, it } from 'vitest'

import { fromChainAmount } from './fromChainAmount'
import { fromChainAmountDisplay, fromChainAmountExact } from './fromChainAmountExact'

describe('fromChainAmountExact', () => {
  it('matches toFixed formatting for small (float-safe) amounts', () => {
    const cases: Array<[string, number]> = [
      ['1500000000000000000', 18],
      ['100000000', 6],
      ['0', 18],
      ['1', 8],
      ['12345678', 8],
    ]
    for (const [raw, dp] of cases) {
      expect(fromChainAmountExact(raw, dp)).toBe(fromChainAmount(raw, dp).toFixed(dp))
    }
  })

  it('is exact where the float64 path drifts (raw > 2^53)', () => {
    // SDK-CORRECTNESS-01 regression: these are the displayed swap-output shapes.
    expect(fromChainAmountExact('123456789012345678901', 18)).toBe('123.456789012345678901')
    expect(fromChainAmountExact('999999999999999999999999', 18)).toBe('999999.999999999999999999')
    expect(fromChainAmountExact('12345678901234567', 8)).toBe('123456789.01234567')

    // and the legacy path really does drift on them (guards against the test
    // silently passing if float64 semantics ever change)
    expect(fromChainAmount('999999999999999999999999', 18).toFixed(18)).toBe('1000000.000000000000000000')
  })

  it('accepts bigint input', () => {
    expect(fromChainAmountExact(123456789012345678901n, 18)).toBe('123.456789012345678901')
  })

  it('handles decimals=0', () => {
    expect(fromChainAmountExact('42', 0)).toBe('42')
  })

  it('pads sub-unit amounts', () => {
    expect(fromChainAmountExact('1', 18)).toBe('0.000000000000000001')
  })

  it('throws on non-integer strings, negatives, and bad decimals', () => {
    expect(() => fromChainAmountExact('1.5', 18)).toThrow()
    expect(() => fromChainAmountExact('1e18', 18)).toThrow()
    expect(() => fromChainAmountExact(-1n, 18)).toThrow()
    expect(() => fromChainAmountExact('1', -1)).toThrow()
    expect(() => fromChainAmountExact('1', 1.5)).toThrow()
  })
})

describe('fromChainAmountDisplay', () => {
  it('uses the exact path for integer base-unit strings', () => {
    expect(fromChainAmountDisplay('999999999999999999999999', 18)).toBe('999999.999999999999999999')
  })

  it('falls back to legacy toFixed for non-integer provider strings (SDK-CORRECTNESS-04 shape)', () => {
    expect(fromChainAmountDisplay('123.45', 6)).toBe((123.45 / 1e6).toFixed(6))
  })
})
