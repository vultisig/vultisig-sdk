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
const encodeStubPlan = (
  overrides: Partial<TW.Bitcoin.Proto.ITransactionPlan> = {}
) =>
  TW.Bitcoin.Proto.TransactionPlan.encode(
    TW.Bitcoin.Proto.TransactionPlan.create({
      amount: 600000,
      availableAmount: 1000000,
      fee: 10000,
      change: 390000,
      error: TW.Common.Proto.SigningError.OK,
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
      ...overrides,
    })
  ).finish()

const makeWalletCore = ({
  isValidAddress = true,
  planBytes,
}: { isValidAddress?: boolean; planBytes?: Uint8Array } = {}) =>
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
      plan: vi.fn(() => planBytes ?? encodeStubPlan()),
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

describe('assertUtxoPlanAcceptable', () => {
  async function loadAssert() {
    const mod = await import('./utxo')
    return mod.assertUtxoPlanAcceptable
  }

  it('allows an empty Error_not_enough_utxos plan when sendMaxAmount is still false so refine can retry', async () => {
    const assertUtxoPlanAcceptable = await loadAssert()
    const plan = TW.Bitcoin.Proto.TransactionPlan.create({
      error: TW.Common.Proto.SigningError.Error_not_enough_utxos,
      utxos: [],
    })

    expect(() =>
      assertUtxoPlanAcceptable({ plan, sendMaxAmount: false, amount: '999450' })
    ).not.toThrow()
  })

  it('throws a mapped error when the same empty plan is already a max-send', async () => {
    const assertUtxoPlanAcceptable = await loadAssert()
    const plan = TW.Bitcoin.Proto.TransactionPlan.create({
      error: TW.Common.Proto.SigningError.Error_not_enough_utxos,
      utxos: [],
    })

    expect(() => assertUtxoPlanAcceptable({ plan, sendMaxAmount: true, amount: '999450' })).toThrow(
      /UTXO coin selection failed \(Error_not_enough_utxos\)/
    )
  })

  it('throws immediately on dust — that is not a refine-retry case', async () => {
    const assertUtxoPlanAcceptable = await loadAssert()
    const plan = TW.Bitcoin.Proto.TransactionPlan.create({
      error: TW.Common.Proto.SigningError.Error_dust_amount_requested,
      utxos: [],
    })

    expect(() => assertUtxoPlanAcceptable({ plan, sendMaxAmount: false, amount: '100' })).toThrow(
      /dust threshold/
    )
  })

  it('does not throw on OK', async () => {
    const assertUtxoPlanAcceptable = await loadAssert()
    const plan = TW.Bitcoin.Proto.TransactionPlan.create({
      error: TW.Common.Proto.SigningError.OK,
      utxos: [
        TW.Bitcoin.Proto.UnspentTransaction.create({
          amount: 1000000,
        }),
      ],
    })

    expect(() => assertUtxoPlanAcceptable({ plan, sendMaxAmount: false, amount: '600000' })).not.toThrow()
  })
})

describe('getUtxoSigningInputs — plan.error mapping', () => {
  it('surfaces a mapped error from a terminal dust plan', async () => {
    const resolver = await getUtxoSigningInputs()
    const payload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Bitcoin,
        ticker: 'BTC',
        address: 'bc1qsource',
        decimals: 8,
        isNativeToken: true,
      }),
      toAddress: 'bc1qdest',
      toAmount: '100',
      blockchainSpecific: {
        case: 'utxoSpecific',
        value: create(UTXOSpecificSchema, {
          byteFee: '10',
          sendMaxAmount: true,
        }),
      },
      utxoInfo: [],
    })

    await expect(
      resolver({
        keysignPayload: payload,
        walletCore: makeWalletCore({
          planBytes: encodeStubPlan({
            error: TW.Common.Proto.SigningError.Error_dust_amount_requested,
            utxos: [],
          }),
        }),
        publicKey: {} as never,
      })
    ).rejects.toThrow(/UTXO coin selection failed \(Error_dust_amount_requested\)/)
  })
})
