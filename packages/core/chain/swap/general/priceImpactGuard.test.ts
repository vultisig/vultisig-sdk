import { describe, expect, it } from 'vitest'

import {
  assertJupiterPriceImpactWithinCeiling,
  evaluateImpactFromFractionString,
  evaluatePriceImpactPercent,
  MAX_PRICE_IMPACT_PCT,
  PriceImpactTooHighError,
} from './priceImpactGuard'

describe('evaluatePriceImpactPercent', () => {
  it('passes when the impact is within the ceiling', () => {
    expect(evaluatePriceImpactPercent(9.99)).toEqual({ ok: true, impactPct: 9.99 })
  })

  it('rejects when the impact exceeds the ceiling', () => {
    expect(evaluatePriceImpactPercent(50)).toEqual({ ok: false, impactPct: 50 })
  })

  it('rejects exactly at the ceiling boundary + 0.01 but passes exactly at the ceiling', () => {
    expect(evaluatePriceImpactPercent(MAX_PRICE_IMPACT_PCT).ok).toBe(true)
    expect(evaluatePriceImpactPercent(MAX_PRICE_IMPACT_PCT + 0.01).ok).toBe(false)
  })

  it('fail-safe passes missing/non-finite/negative impact (no usable signal)', () => {
    expect(evaluatePriceImpactPercent(undefined)).toEqual({ ok: true, impactPct: null })
    expect(evaluatePriceImpactPercent(null)).toEqual({ ok: true, impactPct: null })
    expect(evaluatePriceImpactPercent(NaN)).toEqual({ ok: true, impactPct: null })
    expect(evaluatePriceImpactPercent(-1)).toEqual({ ok: true, impactPct: null })
  })
})

describe('evaluateImpactFromFractionString', () => {
  it('parses a Jupiter-convention fraction string and normalises to percent', () => {
    // "0.5" == 50% impact, well above the 10% ceiling.
    expect(evaluateImpactFromFractionString('0.5')).toEqual({ ok: false, impactPct: 50 })
    // "0.0011" == 0.11% impact, a typical low-impact swap.
    expect(evaluateImpactFromFractionString('0.0011').ok).toBe(true)
  })

  it('fail-safe passes an unparsable string', () => {
    expect(evaluateImpactFromFractionString('not-a-number')).toEqual({ ok: true, impactPct: null })
    expect(evaluateImpactFromFractionString(undefined)).toEqual({ ok: true, impactPct: null })
  })
})

describe('assertJupiterPriceImpactWithinCeiling', () => {
  it('throws PriceImpactTooHighError above the ceiling', () => {
    expect(() => assertJupiterPriceImpactWithinCeiling('0.9')).toThrow(PriceImpactTooHighError)
  })

  it('is a no-op at/under the ceiling or when the field is missing', () => {
    expect(() => assertJupiterPriceImpactWithinCeiling('0.0999')).not.toThrow()
    expect(() => assertJupiterPriceImpactWithinCeiling(undefined)).not.toThrow()
  })
})
