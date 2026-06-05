import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { UTXOSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import {
  OneInchSwapPayloadSchema,
  OneInchQuoteSchema,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { describe, expect, it, vi } from 'vitest'

// Minimal walletCore stub — only the surface used by getUtxoSigningInputs general-swap arm.
// Full signing-path tests (UTXO selection, fee, broadcast) require real WalletCore binaries
// and live in integration tests. This file targets the address-validation guard only.
const makeWalletCore = ({ isValidAddress = true }: { isValidAddress?: boolean } = {}) =>
  ({
    AnyAddress: {
      isValid: vi.fn(() => isValidAddress),
    },
    BitcoinScript: {
      lockScriptForAddress: vi.fn(() => ({
        matchPayToWitnessPublicKeyHash: vi.fn(() => new Uint8Array(20)),
        matchPayToPubkeyHash: vi.fn(() => new Uint8Array(20)),
        data: vi.fn(() => new Uint8Array(0)),
      })),
      hashTypeForCoin: vi.fn(() => 1),
      buildPayToWitnessPubkeyHash: vi.fn(() => ({ data: vi.fn(() => new Uint8Array(0)) })),
      buildPayToPublicKeyHash: vi.fn(() => ({ data: vi.fn(() => new Uint8Array(0)) })),
    },
    HexCoding: {
      decode: vi.fn(() => new Uint8Array(32)),
    },
    AnySigner: {
      plan: vi.fn(() => new Uint8Array(0)),
    },
    CoinType: {
      bitcoin: { value: 0 },
    },
  }) as never

const buildGeneralSwapPayload = (toAddress: string) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Bitcoin,
      ticker: 'BTC',
      address: 'bc1qsource',
      decimals: 8,
      isNativeToken: true,
    }),
    toAddress,
    toAmount: '600000',
    blockchainSpecific: {
      case: 'utxoSpecific',
      value: create(UTXOSpecificSchema, { byteFee: '10', sendMaxAmount: false }),
    },
    utxoInfo: [],
    swapPayload: {
      case: 'oneinchSwapPayload',
      value: create(OneInchSwapPayloadSchema, {
        fromAmount: '600000',
        toAmountDecimal: '0.018',
        provider: 'CHAINFLIP',
        quote: create(OneInchQuoteSchema, {
          dstAmount: '1800000000000000000',
          tx: create(OneInchTransactionSchema, {
            from: 'bc1qsource',
            to: toAddress,
            data: '',
            value: '',
            gasPrice: '',
            gas: 0n,
          }),
        }),
      }),
    },
  })

// Lazy import to defer module resolution until after vi.mock() hooks are set
const getUtxoSigningInputs = async () => {
  const mod = await import('./utxo')
  return mod.getUtxoSigningInputs
}

describe('getUtxoSigningInputs — general swap address validation', () => {
  it('throws when toAddress is empty string', async () => {
    const resolver = await getUtxoSigningInputs()
    const payload = buildGeneralSwapPayload('')
    expect(() => resolver({ keysignPayload: payload, walletCore: makeWalletCore(), publicKey: {} as never })).toThrow(
      'destination address is missing'
    )
  })

  it('throws when walletCore rejects the destination address format', async () => {
    const resolver = await getUtxoSigningInputs()
    const payload = buildGeneralSwapPayload('not-a-valid-btc-address')
    expect(() =>
      resolver({
        keysignPayload: payload,
        walletCore: makeWalletCore({ isValidAddress: false }),
        publicKey: {} as never,
      })
    ).toThrow('not valid for this chain')
  })

  it('proceeds when toAddress is a valid address', async () => {
    const resolver = await getUtxoSigningInputs()
    const payload = buildGeneralSwapPayload('bc1qchainflipdeposit')

    // With the stub walletCore, AnySigner.plan returns empty bytes which
    // will fail to decode a TransactionPlan — that is expected and not what
    // we are testing here. We only assert the validation guard does NOT throw.
    expect(() =>
      resolver({
        keysignPayload: payload,
        walletCore: makeWalletCore({ isValidAddress: true }),
        publicKey: {} as never,
      })
    ).not.toThrow('destination address')
  })
})

describe('Zcash branch ID', () => {
  it('pins the NU6.2 consensus branch ID in WalletCore little-endian hex order', async () => {
    const mod = await import('./utxo')
    expect(mod.ZCASH_BRANCH_ID_NU6_2_LE_HEX).toBe('30f33754')
  })
})
