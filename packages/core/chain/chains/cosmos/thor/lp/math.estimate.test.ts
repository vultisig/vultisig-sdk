import { afterEach, describe, expect, it, vi } from 'vitest'

import { estimateLpAdd } from './math'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const mockFetch = (body: unknown, status = 200) => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as typeof fetch
}

describe('estimateLpAdd', () => {
  it('fetches pool state from thornode and returns a full quote', async () => {
    mockFetch({
      balance_asset: '10000000',
      balance_rune: '100000000000',
      pool_units: '10000000000',
      status: 'Available',
    })

    const quote = await estimateLpAdd({
      pool: 'BTC.BTC',
      runeAmountBaseUnit: '100000000',
      assetAmountBaseUnit: '0',
    })

    expect(quote.liquidityUnits).toBeDefined()
    expect(BigInt(quote.liquidityUnits) > 0n).toBe(true)
    expect(quote.poolShareDecimal).toBeDefined()
    expect(quote.slippageDecimal).toBeDefined()
  })

  it('falls back to LP_units when pool_units is missing', async () => {
    mockFetch({
      balance_asset: '10000000',
      balance_rune: '100000000000',
      LP_units: '10000000000',
    })

    const quote = await estimateLpAdd({
      pool: 'BTC.BTC',
      runeAmountBaseUnit: '100000000',
      assetAmountBaseUnit: '0',
    })
    expect(BigInt(quote.liquidityUnits) > 0n).toBe(true)
  })

  it('returns zero slippage for a deposit matching the pool ratio', async () => {
    mockFetch({
      balance_asset: '10000000',
      balance_rune: '100000000000',
      pool_units: '10000000000',
    })

    const quote = await estimateLpAdd({
      pool: 'BTC.BTC',
      runeAmountBaseUnit: '1000000000',
      assetAmountBaseUnit: '100000',
    })
    expect(quote.slippageDecimal).toBe('0')
  })

  it('throws on malformed pool response (missing balance fields)', async () => {
    mockFetch({ status: 'Available' })
    await expect(
      estimateLpAdd({
        pool: 'BTC.BTC',
        runeAmountBaseUnit: '100000000',
        assetAmountBaseUnit: '0',
      })
    ).rejects.toThrow(/missing balance fields/)
  })

  it('throws on response missing pool_units / LP_units (no silent default)', async () => {
    mockFetch({
      balance_asset: '10000000',
      balance_rune: '100000000000',
    })
    await expect(
      estimateLpAdd({
        pool: 'BTC.BTC',
        runeAmountBaseUnit: '100000000',
        assetAmountBaseUnit: '0',
      })
    ).rejects.toThrow(/pool_units.*LP_units/)
  })

  it('returns non-zero post-deposit shares matching the pool ratio', async () => {
    mockFetch({
      balance_asset: '10000000',
      balance_rune: '100000000000',
      pool_units: '10000000000',
    })

    const quote = await estimateLpAdd({
      pool: 'BTC.BTC',
      runeAmountBaseUnit: '100000000', // 1 RUNE (tiny vs pool)
      assetAmountBaseUnit: '0',
    })

    // Shares should be > 0 for a non-zero deposit on a non-empty pool
    expect(BigInt(quote.runeShareBaseUnit) > 0n).toBe(true)
    expect(BigInt(quote.assetShareBaseUnit) > 0n).toBe(true)
    // The ratio of rune/asset share should approximate the pool ratio
    // (1000 RUNE : 0.1 BTC = 10000 rune per asset base unit)
    const ratio =
      Number(BigInt(quote.runeShareBaseUnit)) /
      Number(BigInt(quote.assetShareBaseUnit))
    expect(ratio).toBeGreaterThan(9000)
    expect(ratio).toBeLessThan(11000)
  })

  it('rejects invalid pool ids via assertValidPoolId', async () => {
    mockFetch({ balance_asset: '1', balance_rune: '1', pool_units: '1' })
    await expect(
      estimateLpAdd({
        pool: 'btc.btc',
        runeAmountBaseUnit: '100000000',
        assetAmountBaseUnit: '0',
      })
    ).rejects.toThrow(/valid THORChain pool id/)
  })
})
