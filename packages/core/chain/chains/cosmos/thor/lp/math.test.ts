import { describe, expect, it } from 'vitest'

import {
  getLiquidityUnits,
  getLpAddSlippage,
  getPoolShare,
} from './math'

// A realistic pool state resembling mainnet BTC.BTC shape (scaled down).
// 1000 RUNE and 0.1 BTC, pool units = 100 (arbitrary starting scale).
// All values in 1e8 base units.
const balancedPool = {
  runeDepth: '100000000000', // 1000 RUNE
  assetDepth: '10000000', // 0.1 BTC
  poolUnits: '10000000000', // 100 units
}

describe('getLiquidityUnits', () => {
  it('returns zero for an uninitialized pool', () => {
    expect(
      getLiquidityUnits({
        pool: { runeDepth: '0', assetDepth: '0', poolUnits: '0' },
        assetAmountBaseUnit: '100000',
        runeAmountBaseUnit: '100000',
      })
    ).toBe('0')
  })

  it('gives non-zero units for a symmetric deposit', () => {
    // Match pool ratio: 10 RUNE + 0.001 BTC
    const units = getLiquidityUnits({
      pool: balancedPool,
      runeAmountBaseUnit: '1000000000', // 10 RUNE
      assetAmountBaseUnit: '100000', // 0.001 BTC
    })
    expect(BigInt(units) > 0n).toBe(true)
  })

  it('gives non-zero units for a pure asym RUNE deposit', () => {
    const units = getLiquidityUnits({
      pool: balancedPool,
      runeAmountBaseUnit: '100000000', // 1 RUNE
      assetAmountBaseUnit: '0',
    })
    expect(BigInt(units) > 0n).toBe(true)
  })

  it('gives non-zero units for a pure asym asset deposit', () => {
    const units = getLiquidityUnits({
      pool: balancedPool,
      runeAmountBaseUnit: '0',
      assetAmountBaseUnit: '10000', // 0.0001 BTC
    })
    expect(BigInt(units) > 0n).toBe(true)
  })

  it('zero inputs produce zero units', () => {
    expect(
      getLiquidityUnits({
        pool: balancedPool,
        runeAmountBaseUnit: '0',
        assetAmountBaseUnit: '0',
      })
    ).toBe('0')
  })

  it('rejects non-numeric string inputs with a clear error (not a SyntaxError)', () => {
    expect(() =>
      getLiquidityUnits({
        pool: balancedPool,
        runeAmountBaseUnit: 'not-a-number',
        assetAmountBaseUnit: '0',
      })
    ).toThrow(/runeAmountBaseUnit.*non-negative integer/)
  })

  it('rejects negative string inputs', () => {
    expect(() =>
      getLiquidityUnits({
        pool: balancedPool,
        runeAmountBaseUnit: '-100',
        assetAmountBaseUnit: '0',
      })
    ).toThrow(/non-negative integer/)
  })

  it('rejects malformed pool state fields', () => {
    expect(() =>
      getLiquidityUnits({
        pool: { runeDepth: 'oops', assetDepth: '1', poolUnits: '1' },
        runeAmountBaseUnit: '100',
        assetAmountBaseUnit: '0',
      })
    ).toThrow(/pool\.runeDepth/)
  })
})

describe('getPoolShare', () => {
  it('returns zero decimal for zero units', () => {
    const share = getPoolShare({
      pool: balancedPool,
      liquidityUnits: '0',
    })
    expect(share.poolShareDecimal).toBe('0')
  })

  it('returns approximately 1% for units equal to 1/99 of total', () => {
    // units / (poolUnits + units) ≈ 1 / 100 = 1%
    const share = getPoolShare({
      pool: balancedPool,
      liquidityUnits: (BigInt(balancedPool.poolUnits) / 99n).toString(),
    })
    const decimal = parseFloat(share.poolShareDecimal)
    expect(decimal).toBeGreaterThan(0.009)
    expect(decimal).toBeLessThan(0.011)
  })

  it('returns 50% for units equal to pool units', () => {
    const share = getPoolShare({
      pool: balancedPool,
      liquidityUnits: balancedPool.poolUnits, // equal to pool → 50%
    })
    expect(share.poolShareDecimal).toBe('0.5')
  })

  it('does NOT return rune/asset base-unit fields (use estimateLpAdd for those)', () => {
    const share = getPoolShare({
      pool: balancedPool,
      liquidityUnits: '100',
    })
    expect('runeShareBaseUnit' in share).toBe(false)
    expect('assetShareBaseUnit' in share).toBe(false)
  })
})

describe('getLpAddSlippage', () => {
  it('is zero when the deposit matches pool ratio exactly', () => {
    // Pool ratio: 1000 RUNE / 0.1 BTC = 10000 RUNE per BTC
    // Matching deposit: 100 RUNE + 0.01 BTC
    const result = getLpAddSlippage({
      pool: balancedPool,
      runeAmountBaseUnit: '10000000000', // 100 RUNE
      assetAmountBaseUnit: '1000000', // 0.01 BTC
    })
    expect(result.decimalPercent).toBe('0')
  })

  it('is non-zero for a pure asym RUNE deposit', () => {
    const result = getLpAddSlippage({
      pool: balancedPool,
      runeAmountBaseUnit: '10000000000', // 100 RUNE
      assetAmountBaseUnit: '0',
    })
    expect(result.decimalPercent).not.toBe('0')
    expect(parseFloat(result.decimalPercent)).toBeGreaterThan(0)
  })

  it('is non-zero for a pure asym asset deposit', () => {
    const result = getLpAddSlippage({
      pool: balancedPool,
      runeAmountBaseUnit: '0',
      assetAmountBaseUnit: '1000000', // 0.01 BTC
    })
    expect(result.decimalPercent).not.toBe('0')
    expect(parseFloat(result.decimalPercent)).toBeGreaterThan(0)
  })

  it('is larger for larger pure-asym deposits (slippage grows with relative size)', () => {
    const small = getLpAddSlippage({
      pool: balancedPool,
      runeAmountBaseUnit: '100000000', // 1 RUNE
      assetAmountBaseUnit: '0',
    })
    const large = getLpAddSlippage({
      pool: balancedPool,
      runeAmountBaseUnit: '50000000000', // 500 RUNE
      assetAmountBaseUnit: '0',
    })
    expect(parseFloat(large.decimalPercent)).toBeGreaterThan(
      parseFloat(small.decimalPercent)
    )
  })

  it('returns zero for empty pools (safeguard)', () => {
    const result = getLpAddSlippage({
      pool: { runeDepth: '0', assetDepth: '0', poolUnits: '0' },
      runeAmountBaseUnit: '100',
      assetAmountBaseUnit: '100',
    })
    expect(result.decimalPercent).toBe('0')
  })

  it('slippage in rune base units is non-zero for asym rune', () => {
    const result = getLpAddSlippage({
      pool: balancedPool,
      runeAmountBaseUnit: '10000000000', // 100 RUNE
      assetAmountBaseUnit: '0',
    })
    expect(BigInt(result.slippageInRuneBaseUnit) > 0n).toBe(true)
  })
})
