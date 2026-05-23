import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getChainSpecific: vi.fn(async () => ({ case: 'rippleSpecific', value: {} })),
  getKeysignUtxoInfo: vi.fn(async () => []),
}))

vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({
  getChainSpecific: mocks.getChainSpecific,
}))

vi.mock('@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo', () => ({
  getKeysignUtxoInfo: mocks.getKeysignUtxoInfo,
}))

vi.mock('@vultisig/core-chain/chains/evm/erc20/getErc20Allowance', () => ({
  getErc20Allowance: vi.fn(),
}))

import { buildSwapKeysignPayload } from './build'

const publicKey = {
  data: () => new Uint8Array([1, 2, 3]),
} as never

describe('buildSwapKeysignPayload transfer routes', () => {
  it('builds a normal source-chain send payload for SwapKit transfer tx variants', async () => {
    const swapQuote: SwapQuote = {
      discounts: [],
      quote: {
        general: {
          dstAmount: '9000000000000000',
          provider: 'swapkit',
          tx: {
            transfer: {
              to: 'rDeposit',
              amount: 1_000_000n,
              memo: '12345',
            },
          },
        },
      },
    }

    const payload = await buildSwapKeysignPayload({
      fromCoin: {
        chain: Chain.Ripple,
        address: 'rSource',
        ticker: 'XRP',
        decimals: 6,
      },
      toCoin: {
        chain: Chain.Ethereum,
        address: '0xdestination',
        ticker: 'ETH',
        decimals: 18,
      },
      amount: 999,
      swapQuote,
      vaultId: 'vault-id',
      localPartyId: 'local-party',
      fromPublicKey: publicKey,
      toPublicKey: publicKey,
      libType: 'DKLS',
      walletCore: {} as never,
    })

    expect(payload.toAddress).toBe('rDeposit')
    expect(payload.toAmount).toBe('1000000')
    expect(payload.memo).toBe('12345')
    expect(payload.swapPayload.case).toBeUndefined()
    expect(mocks.getChainSpecific).toHaveBeenCalledWith(
      expect.objectContaining({
        keysignPayload: expect.objectContaining({
          toAddress: 'rDeposit',
          toAmount: '1000000',
          memo: '12345',
        }),
      })
    )
  })
})
