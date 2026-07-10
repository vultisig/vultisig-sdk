import { describe, expect, it } from 'vitest'

import { getFeeAmountFromGasPrice, parseDecimal } from './cosmosDecimal'

describe('parseDecimal', () => {
  it('parses whole and fractional non-negative decimals exactly', () => {
    expect(parseDecimal('100')).toEqual({ numerator: 100n, denominator: 1n })
    expect(parseDecimal('0.03')).toEqual({ numerator: 3n, denominator: 100n })
    expect(parseDecimal('0.030000000000000000')).toEqual({
      numerator: 30000000000000000n,
      denominator: 1000000000000000000n,
    })
  })

  it('rejects negative, exponential, and non-numeric input', () => {
    expect(parseDecimal('-1')).toBeUndefined()
    expect(parseDecimal('1e5')).toBeUndefined()
    expect(parseDecimal('not-a-number')).toBeUndefined()
    expect(parseDecimal('')).toBeUndefined()
  })

  it('handles a pathologically long but valid decimal without overflow (exact BigInt, not IEEE-754)', () => {
    const huge = '9'.repeat(400)
    const parsed = parseDecimal(huge)
    expect(parsed).toBeDefined()
    expect(parsed?.numerator).toBe(BigInt(huge))
    expect(parsed?.denominator).toBe(1n)
  })
})

describe('getFeeAmountFromGasPrice', () => {
  it('ceil-rounds fractional fee amounts', () => {
    expect(
      getFeeAmountFromGasPrice(200_000n, {
        numerator: 1_000_001n,
        denominator: 1_000_000n,
      })
    ).toBe(200_001n)
  })

  it('never loses precision to floating point for many-significant-digit decimals', () => {
    // A value whose exact ceil-division result an IEEE-754 Number would round
    // incorrectly (real risk for 18-decimal-place cosmos denoms).
    const gasPrice = parseDecimal('0.300000000000000001')!
    expect(getFeeAmountFromGasPrice(300_000n, gasPrice)).toBe(90_001n)
  })
})
