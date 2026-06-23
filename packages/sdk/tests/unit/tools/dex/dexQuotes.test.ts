import { describe, expect, it } from 'vitest'

import { type BalancerPoolState,balancerQuote } from '@/tools/dex/balancerQuote'
import { getAmountOut } from '@/tools/dex/uniswapV2Quote'

describe('uniswap-v2 getAmountOut', () => {
  it('applies the canonical 0.3% fee constant-product formula', () => {
    // Reserves: 10_000 tokenIn / 10_000 tokenOut (18 decimals each).
    const reserveIn = 10_000n * 10n ** 18n
    const reserveOut = 10_000n * 10n ** 18n
    const amountIn = 1n * 10n ** 18n

    const out = getAmountOut(amountIn, reserveIn, reserveOut)

    // Reference value computed directly from (amountIn*997*resOut)/(resIn*1000+amountIn*997).
    const amountInWithFee = amountIn * 997n
    const expected = (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee)
    expect(out).toBe(expected)
    // Sanity: a 1-in swap on a balanced 10k pool nets slightly less than 1 (fee + slippage).
    expect(out).toBeLessThan(amountIn)
    expect(out).toBeGreaterThan((amountIn * 99n) / 100n)
  })

  it('rejects non-positive amounts and empty reserves', () => {
    expect(() => getAmountOut(0n, 1n, 1n)).toThrow(/positive/)
    expect(() => getAmountOut(1n, 0n, 1n)).toThrow(/liquidity/)
    expect(() => getAmountOut(1n, 1n, 0n)).toThrow(/liquidity/)
  })
})

describe('balancer quote (canonical @balancer-labs/balancer-maths Vault)', () => {
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

  // 50/50 weighted pool with 2M USDC (6dp) / 1000 WETH (18dp) -> ~2000 USDC/WETH.
  const poolState: BalancerPoolState = {
    poolType: 'WEIGHTED',
    poolAddress: '0x0000000000000000000000000000000000000001',
    tokens: [USDC, WETH],
    scalingFactors: [1_000_000_000_000n, 1n], // 10^12 to scale 6dp -> 18dp, 10^0 for 18dp
    tokenRates: [10n ** 18n, 10n ** 18n],
    balancesLiveScaled18: [2_000_000n * 10n ** 18n, 1_000n * 10n ** 18n],
    swapFee: 1_000_000_000_000_000n, // 0.1%
    aggregateSwapFee: 0n,
    totalSupply: 1_000n * 10n ** 18n,
    weights: [500_000_000_000_000_000n, 500_000_000_000_000_000n],
    supportsUnbalancedLiquidity: true,
  } as BalancerPoolState

  it('computes EXACT_IN output from on-chain pool state', () => {
    const quote = balancerQuote({
      poolState,
      tokenIn: USDC,
      tokenOut: WETH,
      amountRaw: 1_000n * 10n ** 6n, // 1000 USDC
    })

    expect(quote.protocol).toBe('balancer')
    expect(quote.swapKind).toBe('EXACT_IN')
    const out = BigInt(quote.resultRaw)
    // ~0.499 WETH at 2000:1, fee-adjusted. Bracket to keep the test deterministic.
    expect(out).toBeGreaterThan(49n * 10n ** 16n) // > 0.49 WETH
    expect(out).toBeLessThan(50n * 10n ** 16n) // < 0.50 WETH
  })

  it('rejects identical / invalid tokens and non-positive amounts', () => {
    expect(() => balancerQuote({ poolState, tokenIn: USDC, tokenOut: USDC, amountRaw: 1n })).toThrow(/different/)
    expect(() => balancerQuote({ poolState, tokenIn: 'nope', tokenOut: WETH, amountRaw: 1n })).toThrow(
      /invalid tokenIn/
    )
    expect(() => balancerQuote({ poolState, tokenIn: USDC, tokenOut: WETH, amountRaw: 0n })).toThrow(/positive/)
  })
})
