import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { TW } from '@trustwallet/wallet-core'
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

vi.mock('@vultisig/core-chain/chains/utxo/zcashBranchId', () => ({
  getZcashBranchIdHex: vi.fn(async () => '30f33754'),
}))

// Minimal walletCore stub — only the surface used by getUtxoSigningInputs general-swap arm.
// Full signing-path tests (UTXO selection, fee, broadcast) require real WalletCore binaries
// and live in integration tests. This file targets the address-validation guard only.
// A minimal 1-in / recipient+change plan whose fee clears the ZIP-317 floor
// for a no-memo send, so the Zcash conventional-fee guard returns it as-is.
const encodeStubPlan = () =>
  TW.Bitcoin.Proto.TransactionPlan.encode(
    TW.Bitcoin.Proto.TransactionPlan.create({
      amount: 600000,
      availableAmount: 1000000,
      fee: 10000,
      change: 390000,
      utxos: [
        TW.Bitcoin.Proto.UnspentTransaction.create({
          amount: 1000000,
          outPoint: TW.Bitcoin.Proto.OutPoint.create({
            hash: new Uint8Array(32),
            index: 0,
            sequence: 0xffffffff,
          }),
          script: new Uint8Array(0),
        }),
      ],
    })
  ).finish()

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
      buildPayToWitnessPubkeyHash: vi.fn(() => ({
        data: vi.fn(() => new Uint8Array(0)),
      })),
      buildPayToPublicKeyHash: vi.fn(() => ({
        data: vi.fn(() => new Uint8Array(0)),
      })),
    },
    HexCoding: {
      decode: vi.fn(() => new Uint8Array(32)),
    },
    AnySigner: {
      plan: vi.fn(() => encodeStubPlan()),
    },
    CoinType: {
      bitcoin: { value: 0 },
      zcash: { value: 133 },
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
      value: create(UTXOSpecificSchema, {
        byteFee: '10',
        sendMaxAmount: false,
      }),
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
    await expect(
      resolver({
        keysignPayload: payload,
        walletCore: makeWalletCore(),
        publicKey: {} as never,
      })
    ).rejects.toThrow('destination address is missing')
  })

  it('throws when walletCore rejects the destination address format', async () => {
    const resolver = await getUtxoSigningInputs()
    const payload = buildGeneralSwapPayload('not-a-valid-btc-address')
    await expect(
      resolver({
        keysignPayload: payload,
        walletCore: makeWalletCore({ isValidAddress: false }),
        publicKey: {} as never,
      })
    ).rejects.toThrow('not valid for this chain')
  })

  it('proceeds when toAddress is a valid address', async () => {
    const resolver = await getUtxoSigningInputs()
    const payload = buildGeneralSwapPayload('bc1qchainflipdeposit')

    // The stub walletCore returns a canned plan; the exact plan shape is not
    // what we are testing here. We only assert the validation guard does NOT
    // throw a destination-address error.
    try {
      await resolver({
        keysignPayload: payload,
        walletCore: makeWalletCore({ isValidAddress: true }),
        publicKey: {} as never,
      })
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).not.toContain('destination address')
    }
  })
})

describe('Zcash branch ID', () => {
  it('stamps the live consensus branch ID in WalletCore little-endian hex order', async () => {
    const resolver = await getUtxoSigningInputs()
    const walletCore = makeWalletCore()
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Zcash,
        ticker: 'ZEC',
        address: 't1Source',
        decimals: 8,
        isNativeToken: true,
      }),
      toAddress: 't1Destination',
      toAmount: '600000',
      blockchainSpecific: {
        case: 'utxoSpecific',
        value: create(UTXOSpecificSchema, {
          byteFee: '10',
          sendMaxAmount: false,
        }),
      },
      utxoInfo: [],
    })

    const [input] = await resolver({
      keysignPayload: payload,
      walletCore,
      publicKey: {} as never,
    })

    expect(Buffer.from(input.plan!.branchId!).toString('hex')).toBe('30f33754')
  })
})

describe('Zcash ZIP-317 fee planning', () => {
  it('enables ZIP-317 on the WalletCore planner input for Zcash sends', async () => {
    const resolver = await getUtxoSigningInputs()
    const walletCore = makeWalletCore()
    const plan = (walletCore as unknown as { AnySigner: { plan: ReturnType<typeof vi.fn> } }).AnySigner.plan
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Zcash,
        ticker: 'ZEC',
        address: 't1Source',
        decimals: 8,
        isNativeToken: true,
      }),
      toAddress: 't1Destination',
      toAmount: '600000',
      blockchainSpecific: {
        case: 'utxoSpecific',
        value: create(UTXOSpecificSchema, {
          byteFee: '10',
          sendMaxAmount: false,
        }),
      },
      utxoInfo: [],
    })

    await resolver({
      keysignPayload: payload,
      walletCore,
      publicKey: {} as never,
    })

    const planInput = vi.mocked(plan).mock.calls[0]?.[0]
    expect(planInput).toBeDefined()
    expect(TW.Bitcoin.Proto.SigningInput.decode(planInput).zip_0317).toBe(true)
  })
})
