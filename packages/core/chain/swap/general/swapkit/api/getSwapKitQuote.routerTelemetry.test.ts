import { Chain } from '@vultisig/core-chain/Chain'
import { configureSwapKit } from '@vultisig/core-chain/swap/general/swapkit/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSwapKitQuote } from './getSwapKitQuote'

// sdk#1458: SwapKit destinations are dynamic, so bind the ready-to-sign tx.to to
// the independent targetAddress returned by the provider's screened v3 response.

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

describe('getSwapKitQuote — sdk#1458 targetAddress binding', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    configureSwapKit({ apiKey: undefined, baseUrl: 'https://api.vultisig.com/swapkit-win' })
  })

  const evmRouteFixtures = ({
    txTo = '0x111111125421ca6dc452d289314280a0f8842a65',
    targetAddress = '0x111111125421ca6dc452d289314280a0f8842a65',
  }: { txTo?: string; targetAddress?: string } = {}) => {
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
          targetAddress,
          tx: {
            from: '0xsender',
            to: txTo,
            data: '0xabcdef',
            value: '0',
            gas: '21000',
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })
  }

  it('accepts a transaction whose destination matches the screened targetAddress', async () => {
    evmRouteFixtures()
    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
        to: { chain: Chain.Solana, address: 'sol-destination', ticker: 'USDC', id: 'sol-usdc-mint', decimals: 6 },
        amount: 10_000_000_000_000_000n,
      })
    ).resolves.toBeDefined()
  })

  it('rejects an arbitrary tx.to that differs from the screened targetAddress', async () => {
    evmRouteFixtures({ txTo: '0x000000000000000000000000000000deadbeef' })
    await expect(
      getSwapKitQuote({
        from: {
          chain: Chain.Ethereum,
          address: '0xsender',
          ticker: 'ETH',
          decimals: 18,
        },
        to: {
          chain: Chain.Solana,
          address: 'sol-destination',
          ticker: 'USDC',
          id: 'sol-usdc-mint',
          decimals: 6,
        },
        amount: 10_000_000_000_000_000n,
      })
    ).rejects.toThrow(/does not match the screened targetAddress/)
  })
})
