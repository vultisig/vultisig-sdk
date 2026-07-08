import { Chain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { describe, expect, it, vi } from 'vitest'

import { kyberSwapAffiliateConfig } from '../config'
import { getKyberSwapQuote } from './quote'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

describe('getKyberSwapQuote', () => {
  it('passes affiliate fee params to route and build requests', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        data: {
          routeSummary: { amountOut: '10000000' },
          routerAddress: '0xrouter',
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          amountOut: '10000000',
          data: '0xswap',
          gas: '210000',
          routerAddress: '0xrouter',
        },
      })

    const quote = await getKyberSwapQuote({
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        id: '0xsrc',
        decimals: 18,
        ticker: 'SRC',
      },
      to: {
        chain: Chain.Ethereum,
        address: '0xsender',
        id: '0xdst',
        decimals: 6,
        ticker: 'DST',
      },
      amount: 1_000_000n,
      affiliateBps: 50,
    })

    const [routeUrl, routeOptions] = vi.mocked(queryUrl).mock.calls[0]
    expect(routeUrl).toContain('feeAmount=50')
    expect(routeUrl).toContain('chargeFeeBy=currency_out')
    expect(routeUrl).toContain('isInBps=true')
    expect(routeUrl).toContain(`feeReceiver=${kyberSwapAffiliateConfig.referral}`)
    expect(routeOptions).toMatchObject({
      headers: { 'X-Client-Id': kyberSwapAffiliateConfig.source },
    })

    const [, buildOptions] = vi.mocked(queryUrl).mock.calls[1]
    expect(buildOptions?.body).toMatchObject({
      source: kyberSwapAffiliateConfig.source,
      referral: kyberSwapAffiliateConfig.referral,
      feeAmount: 50,
      chargeFeeBy: 'currency_out',
      isInBps: true,
      feeReceiver: kyberSwapAffiliateConfig.referral,
    })

    expect('evm' in quote.tx ? quote.tx.evm.affiliateFee : undefined).toEqual({
      chain: Chain.Ethereum,
      id: '0xdst',
      decimals: 6,
      amount: 50_251n,
    })
  })

  // Fund-safety investigation (2026-07-07): QA reported a ~10-12% "you receive"
  // premium on same-chain stablecoin->stablecoin swaps via Kyber on Ethereum
  // (USDC->DAI, USDC->USDT). Root-caused by hitting KyberSwap's LIVE public
  // aggregator API directly (bypassing this repo entirely) for the exact same
  // pairs/amounts: the raw `/routes` response for 2 USDC->DAI TODAY returns
  // amountOut 2207447836162962680 (2.2074... DAI, +10.3% vs amountInUsd) via a
  // uniswap-v4-fee hook pool -> balancer-v2-weighted route, and 1.000078
  // USDC->USDT returns amountOut 1120978 (1.120978 USDT, +12% vs amountIn) via
  // the same uniswap-v4-fee hook pool -> a kyberswap PMM leg. These fixtures
  // are that captured live data (trimmed to the fields this function reads).
  //
  // These tests PROVE the anomaly is NOT a decimals/normalization bug in this
  // repo: getKyberSwapQuote relays `amountOut` verbatim (no rescale, no unit
  // conversion) as `dstAmount`, and `dstAmount` here is asserted to equal
  // Kyber's OWN raw figure byte-for-byte. The premium is baked into KyberSwap's
  // upstream route/pricing for this specific pool combination, not introduced
  // anywhere in this codebase. See findSwapQuote's `selectBestEligibleQuote` /
  // `getComparableOutputAmount` (packages/core/chain/swap/quote/findSwapQuote.ts)
  // for the follow-up concern this surfaces: that comparator picks the highest
  // raw output among competing providers with NO plausibility ceiling, so an
  // outlier quote like this one — from ANY single misbehaving aggregator —
  // can outrank a saner quote from 1inch/CowSwap for the same pair.
  it('relays a same-chain USDC->DAI quote verbatim, even when the upstream premium is implausible (captured live 2026-07-07)', async () => {
    const rawAmountOut = '2207447836162962680' // 2.207447836162962680 DAI (18 dec)
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        data: {
          routeSummary: { amountOut: rawAmountOut },
          routerAddress: '0xrouter',
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          amountOut: rawAmountOut,
          data: '0xswap',
          gas: '456836',
          routerAddress: '0xrouter',
        },
      })

    const quote = await getKyberSwapQuote({
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC, 6 dec
        decimals: 6,
        ticker: 'USDC',
      },
      to: {
        chain: Chain.Ethereum,
        address: '0xsender',
        id: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI, 18 dec
        decimals: 18,
        ticker: 'DAI',
      },
      amount: 2_000000n, // 2.0 USDC
    })

    // No decimals bug: our code relays Kyber's own amountOut unmodified.
    expect(quote.dstAmount).toBe(rawAmountOut)

    // The implied rate is NOT ~1:1 for a stablecoin pair — the premium is
    // real and comes from Kyber's own quote, not from anything this repo
    // computes. Documents the anomaly rather than asserting it away.
    const amountInHuman = 2 // 2.0 USDC
    const amountOutHuman = Number(rawAmountOut) / 10 ** 18
    const impliedRate = amountOutHuman / amountInHuman
    expect(impliedRate).toBeGreaterThan(1.05) // >5% above 1:1 — implausible for USDC->DAI
  })

  it('relays a same-chain USDC->USDT quote verbatim, even when the upstream premium is implausible (captured live 2026-07-07)', async () => {
    const rawAmountOut = '1120978' // 1.120978 USDT (6 dec)
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        data: {
          routeSummary: { amountOut: rawAmountOut },
          routerAddress: '0xrouter',
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          amountOut: rawAmountOut,
          data: '0xswap',
          gas: '350000',
          routerAddress: '0xrouter',
        },
      })

    const quote = await getKyberSwapQuote({
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC, 6 dec
        decimals: 6,
        ticker: 'USDC',
      },
      to: {
        chain: Chain.Ethereum,
        address: '0xsender',
        id: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT, 6 dec (SAME decimals as USDC)
        decimals: 6,
        ticker: 'USDT',
      },
      amount: 1_000078n, // 1.000078 USDC
    })

    // No decimals bug: our code relays Kyber's own amountOut unmodified. Both
    // sides are 6-decimal here, so this ALSO rules out a decimals-count
    // mismatch as the cause (a 6-vs-18 mixup would be off by 10^12, not ~12%).
    expect(quote.dstAmount).toBe(rawAmountOut)

    const amountInHuman = 1.000078
    const amountOutHuman = Number(rawAmountOut) / 10 ** 6
    const impliedRate = amountOutHuman / amountInHuman
    expect(impliedRate).toBeGreaterThan(1.05) // >5% above 1:1 — implausible for USDC->USDT
  })
})
