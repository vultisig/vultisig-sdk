import { Chain } from '@vultisig/core-chain/Chain'
import { configureSwapKit } from '@vultisig/core-chain/swap/general/swapkit/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSwapKitQuote } from './getSwapKitQuote'

// AGG-02 (round-2 spec-level fund-safety audit): SwapKit routes through many different
// bridge/DEX contracts by design (diamond routing, multi-hop, chain-specific deployments),
// so — unlike 1inch/Kyber — its destination is logged (never enforced/thrown) via
// knownAggregatorRouters.ts's logUnenforcedAggregatorDestination. This proves that behavior:
// an unrecognized `to` never blocks the quote, and gets logged for future analysis.

const response = (body: unknown) => {
  const serialized = JSON.stringify(body)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: vi.fn(async () => serialized),
    json: vi.fn(async () => body),
  } as unknown as Response
}

describe('getSwapKitQuote — AGG-02 router telemetry (log-only, never enforced)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    configureSwapKit({ apiKey: undefined, baseUrl: 'https://api.vultisig.com/swapkit-win' })
  })

  const evmRouteFixtures = () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [{ routeId: 'near-route', providers: ['NEAR'], expectedBuyAmount: '12.5' }],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '12.4',
          providers: ['NEAR'],
          tx: {
            from: '0xsender',
            to: '0x000000000000000000000000000000deadbeef', // NOT a known router — never enforced for SwapKit
            data: '0xabcdef',
            value: '0',
            gas: '21000',
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })
  }

  it('does NOT throw for an unrecognized destination — SwapKit is never enforced', async () => {
    evmRouteFixtures()
    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
        to: { chain: Chain.Solana, address: 'sol-destination', ticker: 'USDC', id: 'sol-usdc-mint', decimals: 6 },
        amount: 10_000_000_000_000_000n,
      })
    ).resolves.toBeDefined()
  })

  it('logs the destination via swap-router-telemetry for future analysis', async () => {
    evmRouteFixtures()
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Solana, address: 'sol-destination', ticker: 'USDC', id: 'sol-usdc-mint', decimals: 6 },
      amount: 10_000_000_000_000_000n,
    })

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('swap-router-telemetry'), {
      provider: 'swapkit',
      address: '0x000000000000000000000000000000deadbeef',
    })
    infoSpy.mockRestore()
  })
})
