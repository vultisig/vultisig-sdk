import { Buffer } from 'buffer'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { networks, payments, Psbt } from 'bitcoinjs-lib'
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

const TEST_PUBKEY = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')

const makeBitcoinPsbtFixture = () => {
  const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
  const psbt = new Psbt({ network: networks.bitcoin })

  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 0,
    witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 100_000n },
  })
  psbt.addOutput({
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    value: 90_000n,
  })

  return {
    address: p2wpkh.address!,
    payload: psbt.toBuffer(),
  }
}

describe('buildSwapKeysignPayload transfer routes', () => {
  it('rejects Bitcoin SwapKit transfer routes without PSBT data', async () => {
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

    await expect(
      buildSwapKeysignPayload({
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
    ).rejects.toThrow('SwapKit Bitcoin transfer routes must include PSBT txType and txPayload.')
  })

  it('builds SwapKit Bitcoin PSBT payload and SignBitcoin data', async () => {
    mocks.getChainSpecific.mockResolvedValueOnce({
      case: 'utxoSpecific',
      value: { byteFee: '10', sendMaxAmount: false },
    })
    const psbt = makeBitcoinPsbtFixture()

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
              txType: 'PSBT',
              txPayload: psbt.payload,
            },
          },
        },
      },
    }

    const payload = await buildSwapKeysignPayload({
      fromCoin: {
        chain: Chain.Bitcoin,
        address: psbt.address,
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
    expect(payload.swapPayload.case).toBe('swapkitSwapPayload')
    if (payload.swapPayload.case === 'swapkitSwapPayload') {
      expect(payload.swapPayload.value.fromAmount).toBe('600000')
      expect(payload.swapPayload.value.targetAddress).toBe('bc1qchainflipdeposit')
      expect(payload.swapPayload.value.subProvider).toBe('CHAINFLIP')
      expect(payload.swapPayload.value.txType).toBe('PSBT')
      expect(payload.swapPayload.value.txPayload).toEqual(psbt.payload)
    }
    expect(payload.signData.case).toBe('signBitcoin')
    if (payload.signData.case === 'signBitcoin') {
      expect(payload.signData.value.inputs).toHaveLength(1)
      expect(payload.signData.value.outputs).toHaveLength(1)
      expect(payload.signData.value.inputs[0].isOurs).toBe(true)
    }

    const roundtrip = fromBinary(
      KeysignPayloadSchema,
      toBinary(
        KeysignPayloadSchema,
        create(KeysignPayloadSchema, {
          swapPayload: payload.swapPayload,
        })
      )
    )
    expect(roundtrip.swapPayload.case).toBe('swapkitSwapPayload')
    if (roundtrip.swapPayload.case === 'swapkitSwapPayload') {
      expect(roundtrip.swapPayload.value.targetAddress).toBe('bc1qchainflipdeposit')
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
              txType: 'TRANSFER',
              swapId: 'swapkit-id',
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
    expect(payload.swapPayload.case).toBe('swapkitSwapPayload')
    if (payload.swapPayload.case === 'swapkitSwapPayload') {
      expect(payload.swapPayload.value.fromAmount).toBe('1000000')
      expect(payload.swapPayload.value.targetAddress).toBe('rDeposit')
      expect(payload.swapPayload.value.memo).toBe('12345')
      expect(payload.swapPayload.value.txType).toBe('TRANSFER')
      expect(payload.swapPayload.value.swapId).toBe('swapkit-id')
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
