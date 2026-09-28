import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { TW } from '@trustwallet/wallet-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UTXOSpecificSchema } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { BuildKeysignPayloadError } from '../error'

const mocks = vi.hoisted(() => ({
  getUtxoSigningInputs: vi.fn(),
}))

vi.mock('../signingInputs/resolvers/utxo', () => ({
  getUtxoSigningInputs: mocks.getUtxoSigningInputs,
}))

import { refineKeysignUtxo } from './utxo'

const buildPayload = (amount = 100n) =>
  create(KeysignPayloadSchema, {
    coin: {
      chain: Chain.Bitcoin,
      ticker: 'BTC',
      decimals: 8,
      address: 'bc1qsender',
      isNativeToken: true,
    },
    toAddress: 'bc1qrecipient',
    toAmount: amount.toString(),
    blockchainSpecific: {
      case: 'utxoSpecific',
      value: create(UTXOSpecificSchema, {
        byteFee: '1',
        sendMaxAmount: false,
      }),
    },
    utxoInfo: [{ hash: '00'.repeat(32), amount: 1_000n, index: 0 }],
  })

const hexEncode = vi.fn(() => '00'.repeat(32))

const walletCore = {
  HexCoding: {
    encode: hexEncode,
  },
} as never

const planWith = (error: TW.Common.Proto.SigningError, utxos: TW.Bitcoin.Proto.IUnspentTransaction[] = []) => ({
  plan: TW.Bitcoin.Proto.TransactionPlan.create({ error, fee: 100, utxos }),
})

const selectedUtxo = TW.Bitcoin.Proto.UnspentTransaction.create({
  amount: 1_000,
  outPoint: TW.Bitcoin.Proto.OutPoint.create({
    hash: new Uint8Array(32),
    index: 0,
  }),
})

describe('refineKeysignUtxo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a dust planner error without retrying the request as send-max', async () => {
    mocks.getUtxoSigningInputs.mockResolvedValue([planWith(TW.Common.Proto.SigningError.Error_dust_amount_requested)])

    const promise = refineKeysignUtxo({
      keysignPayload: buildPayload(),
      walletCore,
      publicKey: {} as never,
    })

    await expect(promise).rejects.toMatchObject({
      name: 'BuildKeysignPayloadError',
      type: 'utxo-dust-amount-requested',
      message: expect.stringContaining('0.00000546 BTC'),
    } satisfies Partial<BuildKeysignPayloadError>)
    expect(mocks.getUtxoSigningInputs).toHaveBeenCalledTimes(1)
    expect(mocks.getUtxoSigningInputs.mock.calls[0]?.[0].keysignPayload.blockchainSpecific.value.sendMaxAmount).toBe(
      false
    )
  })

  it('rejects insufficient UTXOs without retrying the request as send-max', async () => {
    mocks.getUtxoSigningInputs.mockResolvedValue([planWith(TW.Common.Proto.SigningError.Error_not_enough_utxos)])

    const promise = refineKeysignUtxo({
      keysignPayload: buildPayload(),
      walletCore,
      publicKey: {} as never,
    })

    await expect(promise).rejects.toMatchObject({
      name: 'BuildKeysignPayloadError',
      type: 'not-enough-funds',
      message: expect.stringContaining('insufficient balance'),
    } satisfies Partial<BuildKeysignPayloadError>)
    expect(mocks.getUtxoSigningInputs).toHaveBeenCalledTimes(1)
    expect(mocks.getUtxoSigningInputs.mock.calls[0]?.[0].keysignPayload.blockchainSpecific.value.sendMaxAmount).toBe(
      false
    )
  })

  it('treats a planner error as authoritative even when the plan selected UTXOs', async () => {
    mocks.getUtxoSigningInputs.mockResolvedValue([
      planWith(TW.Common.Proto.SigningError.Error_not_enough_utxos, [selectedUtxo]),
    ])

    await expect(
      refineKeysignUtxo({
        keysignPayload: buildPayload(),
        walletCore,
        publicKey: {} as never,
      })
    ).rejects.toMatchObject({
      name: 'BuildKeysignPayloadError',
      type: 'not-enough-funds',
    } satisfies Partial<BuildKeysignPayloadError>)
    expect(hexEncode).not.toHaveBeenCalled()
  })

  it('reports a fee-rate dust threshold when the amount is above the static floor', async () => {
    mocks.getUtxoSigningInputs.mockResolvedValue([planWith(TW.Common.Proto.SigningError.Error_dust_amount_requested)])

    await expect(
      refineKeysignUtxo({
        keysignPayload: buildPayload(1_019n),
        walletCore,
        publicKey: {} as never,
      })
    ).rejects.toMatchObject({
      name: 'BuildKeysignPayloadError',
      type: 'utxo-dust-amount-requested',
      message:
        'Amount 0.00001019 BTC is below the network dust threshold at the current fee rate; increase the amount and try again.',
    } satisfies Partial<BuildKeysignPayloadError>)
  })

  it('rejects a successful planner result that contains no inputs', async () => {
    mocks.getUtxoSigningInputs.mockResolvedValue([planWith(TW.Common.Proto.SigningError.OK)])

    await expect(
      refineKeysignUtxo({
        keysignPayload: buildPayload(),
        walletCore,
        publicKey: {} as never,
      })
    ).rejects.toThrow('Failed to build transaction: planner returned no inputs')
  })

  it('retries as send-max when a successful plan would leave dust change', async () => {
    mocks.getUtxoSigningInputs
      .mockResolvedValueOnce([planWith(TW.Common.Proto.SigningError.OK, [selectedUtxo])])
      .mockResolvedValueOnce([planWith(TW.Common.Proto.SigningError.OK, [selectedUtxo])])

    const refined = await refineKeysignUtxo({
      keysignPayload: buildPayload(400n),
      walletCore,
      publicKey: {} as never,
    })

    expect(mocks.getUtxoSigningInputs).toHaveBeenCalledTimes(2)
    if (refined.blockchainSpecific.case !== 'utxoSpecific') throw new Error('Expected UTXO-specific payload')
    expect(refined.blockchainSpecific.value.sendMaxAmount).toBe(true)
    expect(refined.utxoInfo).toHaveLength(1)
  })

  it('rejects an over-balance request even when the planner returns a successful clamped plan', async () => {
    mocks.getUtxoSigningInputs.mockResolvedValue([planWith(TW.Common.Proto.SigningError.OK, [selectedUtxo])])

    await expect(
      refineKeysignUtxo({
        keysignPayload: buildPayload(1_001n),
        walletCore,
        publicKey: {} as never,
      })
    ).rejects.toMatchObject({
      name: 'BuildKeysignPayloadError',
      type: 'not-enough-funds',
      message: 'Failed to build transaction: insufficient balance (requested 0.00001001 BTC, available 0.00001 BTC)',
    } satisfies Partial<BuildKeysignPayloadError>)
    expect(mocks.getUtxoSigningInputs).toHaveBeenCalledTimes(1)
    expect(mocks.getUtxoSigningInputs.mock.calls[0]?.[0].keysignPayload.blockchainSpecific.value.sendMaxAmount).toBe(
      false
    )
  })

  it('retries as send-max when a successful plan would leave exactly zero change', async () => {
    mocks.getUtxoSigningInputs
      .mockResolvedValueOnce([planWith(TW.Common.Proto.SigningError.OK, [selectedUtxo])])
      .mockResolvedValueOnce([planWith(TW.Common.Proto.SigningError.OK, [selectedUtxo])])

    const refined = await refineKeysignUtxo({
      keysignPayload: buildPayload(1_000n),
      walletCore,
      publicKey: {} as never,
    })

    expect(mocks.getUtxoSigningInputs).toHaveBeenCalledTimes(2)
    if (refined.blockchainSpecific.case !== 'utxoSpecific') throw new Error('Expected UTXO-specific payload')
    expect(refined.blockchainSpecific.value.sendMaxAmount).toBe(true)
  })
})
