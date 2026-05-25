import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getChainSpecific: vi.fn(async () => ({ case: 'rippleSpecific', value: {} })),
  getKeysignUtxoInfo: vi.fn(async () => []),
  // refineKeysignUtxo is mocked to return the payload unchanged. This means:
  //   - UTXO selection, fee calculation, and address validation inside refineKeysignUtxo
  //     are NOT exercised by these tests.
  //   - These tests cover buildSwapKeysignPayload surface behavior only: that the correct
  //     oneinchSwapPayload is built and keysignPayload.toAddress / memo are set correctly.
  //   - Address format validation is covered by the getUtxoSigningInputs unit tests
  //     (packages/core/mpc/keysign/signingInputs/resolvers/utxo.test.ts).
  refineKeysignUtxo: vi.fn((input: { keysignPayload: unknown }) => input.keysignPayload),
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

vi.mock('@vultisig/core-mpc/keysign/refine/utxo', () => ({
  refineKeysignUtxo: mocks.refineKeysignUtxo,
}))

import { buildSwapKeysignPayload } from './build'

const publicKey = {
  data: () => new Uint8Array([1, 2, 3]),
} as never

describe('buildSwapKeysignPayload transfer routes', () => {
  it('builds oneinchSwapPayload for UTXO source (Chainflip, no memo)', async () => {
    mocks.getChainSpecific.mockResolvedValueOnce({
      case: 'utxoSpecific',
      value: { byteFee: '10', sendMaxAmount: false },
    })

    const swapQuote: SwapQuote = {
      discounts: [],
      quote: {
        general: {
          dstAmount: '1800000000000000000',
          provider: 'swapkit',
          routeProvider: 'CHAINFLIP',
          tx: {
            transfer: {
              to: 'bc1qchainflipdeposit',
              amount: 600_000n,
            },
          },
        },
      },
    }

    const payload = await buildSwapKeysignPayload({
      fromCoin: {
        chain: Chain.Bitcoin,
        address: 'bc1qsource',
        ticker: 'BTC',
        decimals: 8,
      },
      toCoin: {
        chain: Chain.Ethereum,
        address: '0xdestination',
        ticker: 'ETH',
        decimals: 18,
      },
      amount: 0.006,
      swapQuote,
      vaultId: 'vault-id',
      localPartyId: 'local-party',
      fromPublicKey: publicKey,
      toPublicKey: publicKey,
      libType: 'DKLS',
      walletCore: {} as never,
    })

    expect(payload.toAddress).toBe('bc1qchainflipdeposit')
    expect(payload.toAmount).toBe('600000')
    expect(payload.memo).toBeUndefined()
    // Must have a real swap payload — SwapVerify throws if case is undefined.
    expect(payload.swapPayload.case).toBe('oneinchSwapPayload')
    if (payload.swapPayload.case === 'oneinchSwapPayload') {
      expect(payload.swapPayload.value.fromAmount).toBe('600000')
      expect(payload.swapPayload.value.quote?.tx?.from).toBe('bc1qsource')
      expect(payload.swapPayload.value.quote?.tx?.to).toBe('bc1qchainflipdeposit')
    }
  })

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
    // Transfer routes now emit oneinchSwapPayload so SwapVerify can display swap details.
    expect(payload.swapPayload.case).toBe('oneinchSwapPayload')
    if (payload.swapPayload.case === 'oneinchSwapPayload') {
      expect(payload.swapPayload.value.fromAmount).toBe('1000000')
      expect(payload.swapPayload.value.quote?.tx?.from).toBe('rSource')
      expect(payload.swapPayload.value.quote?.tx?.to).toBe('rDeposit')
    }
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
