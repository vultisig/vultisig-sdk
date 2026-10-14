import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getChainSpecific: vi.fn(async () => ({
    case: 'nearSpecific',
    value: { gasFee: '1' },
  })),
  getCoinBalance: vi.fn(async () => 10n),
  assertNearSendAffordable: vi.fn(async () => {}),
}))

vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({
  getChainSpecific: mocks.getChainSpecific,
}))
vi.mock('@vultisig/core-chain/coin/balance', () => ({
  getCoinBalance: mocks.getCoinBalance,
}))
vi.mock('@vultisig/core-mpc/keysign/refine/near', () => ({
  assertNearSendAffordable: mocks.assertNearSendAffordable,
}))

import { buildSwapKeysignPayload } from './build'

const publicKey = { data: () => new Uint8Array([1, 2, 3]) } as never

const NEAR_SOURCE = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'
const NEAR_DEPOSIT = '14397e36f7e4f15599c8ba31baac5fbfd79b415729428ba70d94aee794a4f27f'

const swapQuote: SwapQuote = {
  discounts: [],
  quote: {
    general: {
      dstAmount: '1800000000000000000',
      provider: 'swapkit',
      routeProvider: 'NEAR',
      tx: { transfer: { to: NEAR_DEPOSIT, amount: 5n * 10n ** 24n } },
    },
  },
}

const build = (fromCoin: { chain: Chain; address: string; ticker: string; decimals: number; id?: string }) =>
  buildSwapKeysignPayload({
    fromCoin,
    toCoin: {
      chain: Chain.Ethereum,
      address: '0xdestination',
      ticker: 'ETH',
      decimals: 18,
    },
    amount: 5,
    swapQuote,
    vaultId: 'vault-id',
    localPartyId: 'local-party',
    fromPublicKey: publicKey,
    toPublicKey: publicKey,
    libType: 'DKLS',
    walletCore: {} as never,
  })

const nearCoin = {
  chain: Chain.Near,
  address: NEAR_SOURCE,
  ticker: 'NEAR',
  decimals: 24,
}

describe('buildSwapKeysignPayload NEAR source affordability', () => {
  it('checks a native NEAR swap against the balance, amount and gas reservation', async () => {
    mocks.assertNearSendAffordable.mockClear()

    const payload = await build(nearCoin)

    expect(payload.toAddress).toBe(NEAR_DEPOSIT)
    expect(payload.toAmount).toBe((5n * 10n ** 24n).toString())
    expect(mocks.assertNearSendAffordable).toHaveBeenCalledOnce()
    expect(mocks.assertNearSendAffordable).toHaveBeenCalledWith({
      keysignPayload: payload,
      balance: 10n,
      coin: expect.objectContaining({
        chain: Chain.Near,
        address: NEAR_SOURCE,
      }),
    })
  })

  it('refuses an unaffordable NEAR swap before it is returned for signing', async () => {
    mocks.assertNearSendAffordable.mockRejectedValueOnce(new Error('not-enough-funds'))

    await expect(build(nearCoin)).rejects.toThrow('not-enough-funds')
  })

  it('does not run the NEAR check for non-NEAR sources', async () => {
    mocks.assertNearSendAffordable.mockClear()
    mocks.getChainSpecific.mockResolvedValueOnce({
      case: 'rippleSpecific',
      value: {},
    } as never)

    await build({
      chain: Chain.Ripple,
      address: 'rSource',
      ticker: 'XRP',
      decimals: 6,
    })

    expect(mocks.assertNearSendAffordable).not.toHaveBeenCalled()
  })
})
