import { afterEach, describe, expect, it, vi } from 'vitest'

import { type BalancerPoolState, balancerQuote } from '@/tools/dex/balancerQuote'
import { getAmountOut, uniswapV2Quote } from '@/tools/dex/uniswapV2Quote'

// Mock the EVM read layer so we can drive uniswapV2Quote's factory/pair/reserve
// reads deterministically and exercise the pair-identity guard + reserve mapping
// without hitting an RPC.
vi.mock('@/tools/evm', () => ({
  evmCall: vi.fn(),
}))

import { evmCall } from '@/tools/evm'

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

describe('uniswapV2Quote reserve mapping + pair-identity guard', () => {
  const ETH = 'Ethereum' as unknown as Parameters<typeof uniswapV2Quote>[0]['chain']
  // token0 is the lexicographically smaller address by V2 convention.
  const T0 = '0x1111111111111111111111111111111111111111' // < T1
  const T1 = '0x2222222222222222222222222222222222222222'
  const OTHER = '0x3333333333333333333333333333333333333333'
  const PAIR = '0x000000000000000000000000000000000000beef'

  const word = (hex: string) => ('0x' + hex.replace(/^0x/, '').padStart(64, '0')) as `0x${string}`
  const addrWord = (addr: string) => word(addr.slice(2).toLowerCase())
  const uint = (n: bigint) => n.toString(16)

  afterEach(() => vi.mocked(evmCall).mockReset())

  // selector -> response router shared by the happy-path + guard tests.
  function installMock(opts: { token0: string; token1: string }) {
    vi.mocked(evmCall).mockImplementation(async (_chain, call) => {
      const data = (call.data ?? '0x') as string
      const sel = data.slice(0, 10)
      if (sel === '0xe6a43905') return addrWord(PAIR) // getPair -> pair address
      if (sel === '0x0dfe1681') return addrWord(opts.token0) // token0()
      if (sel === '0xd21220a7') return addrWord(opts.token1) // token1()
      if (sel === '0x0902f1ac') {
        // getReserves(): reserve0=1000e18, reserve1=2000e18, ts=0
        return ('0x' +
          uint(1000n * 10n ** 18n).padStart(64, '0') +
          uint(2000n * 10n ** 18n).padStart(64, '0') +
          ''.padStart(64, '0')) as `0x${string}`
      }
      if (sel === '0x313ce567') return word('12') // decimals() = 18
      if (sel === '0x95d89b41') {
        // symbol() returns abi-encoded string "TKN"
        return ('0x' +
          ''.padStart(64, '0').replace(/0$/, '') +
          '0000000000000000000000000000000000000000000000000000000000000020' +
          '0000000000000000000000000000000000000000000000000000000000000003' +
          '544b4e0000000000000000000000000000000000000000000000000000000000') as `0x${string}`
      }
      return '0x' as `0x${string}`
    })
  }

  it('maps reserves correctly when tokenIn is token0', async () => {
    installMock({ token0: T0, token1: T1 })
    const q = await uniswapV2Quote({ chain: ETH, tokenIn: T0, tokenOut: T1, amountIn: '1' })
    // tokenIn == token0 -> reserveIn = reserve0 (1000e18), reserveOut = reserve1 (2000e18)
    expect(q.reserveInRaw).toBe((1000n * 10n ** 18n).toString())
    expect(q.reserveOutRaw).toBe((2000n * 10n ** 18n).toString())
  })

  it('maps reserves correctly when tokenIn is token1 (swapped direction)', async () => {
    installMock({ token0: T0, token1: T1 })
    const q = await uniswapV2Quote({ chain: ETH, tokenIn: T1, tokenOut: T0, amountIn: '1' })
    // tokenIn == token1 -> reserveIn = reserve1 (2000e18), reserveOut = reserve0 (1000e18)
    expect(q.reserveInRaw).toBe((2000n * 10n ** 18n).toString())
    expect(q.reserveOutRaw).toBe((1000n * 10n ** 18n).toString())
  })

  it('rejects a factory-returned pair that does not hold {tokenIn, tokenOut}', async () => {
    // Malicious/buggy factory: getPair returns a pair whose token1 is an unrelated token.
    installMock({ token0: T0, token1: OTHER })
    await expect(uniswapV2Quote({ chain: ETH, tokenIn: T0, tokenOut: T1, amountIn: '1' })).rejects.toThrow(
      /token mismatch/
    )
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

  it('fails closed when a token is not a member of the supplied poolState', () => {
    // The poolState is the trust boundary — a token not in poolState.tokens must
    // be rejected before the canonical math runs, so a stale/attacker poolState
    // can't produce a plausible-but-fake quote.
    const FOREIGN = '0x1111111111111111111111111111111111111111'
    expect(() => balancerQuote({ poolState, tokenIn: FOREIGN, tokenOut: WETH, amountRaw: 1n })).toThrow(/not a member/)
    expect(() => balancerQuote({ poolState, tokenIn: USDC, tokenOut: FOREIGN, amountRaw: 1n })).toThrow(/not a member/)
  })
})
