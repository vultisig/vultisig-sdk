import { Chain } from '@vultisig/core-chain/Chain'
import { scanAddressWithBlockaid } from '@vultisig/core-chain/security/blockaid/address'
import { configureSwapKit } from '@vultisig/core-chain/swap/general/swapkit/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSwapKitQuote } from './getSwapKitQuote'

vi.mock('@vultisig/core-chain/security/blockaid/address', () => ({ scanAddressWithBlockaid: vi.fn() }))

const mockScanAddressWithBlockaid = vi.mocked(scanAddressWithBlockaid)

// sdk#1458: SwapKit destinations are dynamic. Keep the response-local tx.to /
// targetAddress binding as defense in depth, and require an independent Blockaid
// reputation verdict before returning either destination in a signable quote.

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
  beforeEach(() => {
    mockScanAddressWithBlockaid.mockReset()
    mockScanAddressWithBlockaid.mockResolvedValue({ resultType: 'Benign', features: ['trusted'] })
  })

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
        response({ routes: [{ routeId: 'near-route', providers: ['NEAR'], expectedBuyAmount: '12.5' }] })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '12.4',
          providers: ['NEAR'],
          targetAddress,
          tx: { from: '0xsender', to: txTo, data: '0xabcdef', value: '0', gas: '21000' },
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
    expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith('0x111111125421ca6dc452d289314280a0f8842a65', 'ethereum')
  })

  it.each(['Warning', 'Malicious'] as const)(
    'rejects matching response-controlled destinations when Blockaid returns %s',
    async resultType => {
      const attacker = '0x00000000000000000000000000000000deadbeef'
      mockScanAddressWithBlockaid.mockResolvedValueOnce({ resultType, features: ['untrusted'] })
      evmRouteFixtures({ txTo: attacker, targetAddress: attacker })

      await expect(
        getSwapKitQuote({
          from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
          to: { chain: Chain.Bitcoin, address: 'bc1destination', ticker: 'BTC', decimals: 8 },
          amount: 10_000_000_000_000_000n,
        })
      ).rejects.toThrow(new RegExp(`${resultType} Blockaid verdict`))
    }
  )

  it('fails closed when the independent reputation service is unavailable', async () => {
    mockScanAddressWithBlockaid.mockRejectedValueOnce(new Error('service unavailable'))
    evmRouteFixtures()

    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
        to: { chain: Chain.Bitcoin, address: 'bc1destination', ticker: 'BTC', decimals: 8 },
        amount: 10_000_000_000_000_000n,
      })
    ).rejects.toThrow(/reputation check failed.*service unavailable/)
  })

  it('rejects an arbitrary tx.to that differs from the screened targetAddress', async () => {
    evmRouteFixtures({ txTo: '0x000000000000000000000000000000deadbeef' })
    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
        to: { chain: Chain.Solana, address: 'sol-destination', ticker: 'USDC', id: 'sol-usdc-mint', decimals: 6 },
        amount: 10_000_000_000_000_000n,
      })
    ).rejects.toThrow(/does not match the screened targetAddress/)
  })
})
