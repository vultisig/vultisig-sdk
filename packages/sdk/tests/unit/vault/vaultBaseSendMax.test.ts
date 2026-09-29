import { create } from '@bufbuild/protobuf'
import { TW } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

const {
  mockBuildSendKeysignPayload,
  mockGetSendFeeEstimate,
  mockGetPublicKey,
  mockGetUtxoSigningInputs,
  mockIsValidRecipient,
} = vi.hoisted(() => ({
  mockBuildSendKeysignPayload: vi.fn(),
  mockGetSendFeeEstimate: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockGetUtxoSigningInputs: vi.fn(),
  mockIsValidRecipient: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/send/build', () => ({
  buildSendKeysignPayload: mockBuildSendKeysignPayload,
}))
vi.mock('@vultisig/core-mpc/keysign/send/getSendFeeEstimate', () => ({
  getSendFeeEstimate: mockGetSendFeeEstimate,
}))
vi.mock('@vultisig/core-mpc/keysign/signingInputs/resolvers/utxo', () => ({
  getUtxoSigningInputs: mockGetUtxoSigningInputs,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@vultisig/core-chain/utils/isValidRecipient', () => ({
  isValidRecipient: mockIsValidRecipient,
}))
vi.mock('@vultisig/mpc-types', () => ({ getMpcEngine: vi.fn() }))

import { refineKeysignUtxo } from '@vultisig/core-mpc/keysign/refine/utxo'
import { UTXOSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { TransactionBuilder } from '@/vault/services/TransactionBuilder'
import { VaultBase } from '@/vault/VaultBase'
import { VaultErrorCode } from '@/vault/VaultError'

const tonCoin = {
  chain: Chain.Ton,
  address: 'UQfrom',
  decimals: 9,
  ticker: 'TON',
}

const maxSendable = 9_950_000_000n

/**
 * `send` is exercised against a stub receiver rather than a constructed vault: the
 * only thing under test is which flags it hands `prepareSendTx`, and a real vault
 * would drag in wasm, balances and signing to observe one argument.
 */
const callSend = async (amount: string) => {
  const prepareSendTx = vi.fn().mockResolvedValue({ __mock: 'payload' })
  const stub = {
    resolveTokenInfo: () => ({
      decimals: 9,
      ticker: 'TON',
      contractAddress: undefined,
    }),
    buildAccountCoin: () => tonCoin,
    address: async () => tonCoin.address,
    getMaxSendAmount: async () => ({ maxSendable }),
    parseAmount: (value: string) => BigInt(value),
    formatUnits: (value: bigint) => value.toString(),
    transactionBuilder: { estimateSendFee: async () => 10_000_000n },
    prepareSendTx,
  }

  const result = await VaultBase.prototype.send.call(stub as never, {
    chain: Chain.Ton,
    to: 'UQto',
    amount,
    dryRun: true,
  })

  return { prepareSendTx, result }
}

describe('VaultBase.send — MAX intent', () => {
  it('records MAX when the caller asked for it', async () => {
    const { prepareSendTx } = await callSend('max')

    expect(prepareSendTx).toHaveBeenCalledWith(expect.objectContaining({ amount: maxSendable, sendMaxAmount: true }))
  })

  it('does not record MAX for an explicit amount, even one equal to the max', async () => {
    const { prepareSendTx } = await callSend(maxSendable.toString())

    expect(prepareSendTx).toHaveBeenCalledWith(expect.objectContaining({ sendMaxAmount: false }))
  })

  it('resolves a Bitcoin max dry-run when only a max planner can price the full balance', async () => {
    const balance = 12_621n
    const fee = 500n
    const planner = vi.fn(({ sendMaxAmount }: { sendMaxAmount?: boolean }) => {
      if (!sendMaxAmount) return { error: 'Error_not_enough_utxos', utxos: [] }
      return { fee, utxos: [{ amount: balance }] }
    })
    const estimateFromPlanner = vi.fn((input: { sendMaxAmount?: boolean }) => {
      const plan = planner(input)
      if ('error' in plan) throw new Error(plan.error)
      return plan.fee
    })
    mockGetSendFeeEstimate.mockImplementation(estimateFromPlanner)
    mockGetPublicKey.mockReturnValue({ __mock: 'publicKey' })
    mockIsValidRecipient.mockReturnValue(true)

    const prepareSendTx = vi.fn().mockResolvedValue({ __mock: 'bitcoin-payload' })
    const bitcoinCoin = {
      chain: Chain.Bitcoin,
      address: 'bc1qsender',
      decimals: 8,
      ticker: 'BTC',
    }
    const stub = {
      resolveTokenInfo: () => ({
        decimals: 8,
        ticker: 'BTC',
        contractAddress: undefined,
      }),
      buildAccountCoin: () => bitcoinCoin,
      address: async () => bitcoinCoin.address,
      getMaxSendAmount: VaultBase.prototype.getMaxSendAmount,
      wasmProvider: {
        getWalletCore: vi.fn().mockResolvedValue({ __mock: 'walletCore' }),
      },
      balanceService: {
        getBalance: vi.fn().mockResolvedValue({ amount: balance.toString() }),
      },
      coreVault: {
        publicKeys: { ecdsa: '02ecdsa-public-key', eddsa: 'eddsa-public-key' },
        hexChainCode: 'deadbeef',
        localPartyId: 'iPhone-A1B2',
        libType: 'DKLS',
      },
      parseAmount: (value: string) => BigInt(value),
      formatUnits: (value: bigint) => value.toString(),
      transactionBuilder: { estimateSendFee: estimateFromPlanner },
      prepareSendTx,
    }

    await expect(
      VaultBase.prototype.send.call(stub as never, {
        chain: Chain.Bitcoin,
        to: 'bc1qreceiver',
        amount: 'max',
        dryRun: true,
      })
    ).resolves.toMatchObject({
      dryRun: true,
      fee: fee.toString(),
      total: balance.toString(),
    })

    expect(planner).toHaveBeenCalledTimes(2)
    expect(planner).toHaveBeenNthCalledWith(1, expect.objectContaining({ amount: balance, sendMaxAmount: true }))
    expect(planner).toHaveBeenNthCalledWith(2, expect.objectContaining({ amount: balance - fee, sendMaxAmount: true }))
  })

  it('rejects a Bitcoin over-balance dry-run when the planner clamps to a successful plan', async () => {
    const balance = 12_621n
    const requestedAmount = 100_000n
    const planner = vi.fn(() => ({
      plan: TW.Bitcoin.Proto.TransactionPlan.create({
        error: TW.Common.Proto.SigningError.OK,
        fee: 4_102,
        utxos: [
          TW.Bitcoin.Proto.UnspentTransaction.create({
            amount: balance,
            outPoint: TW.Bitcoin.Proto.OutPoint.create({
              hash: new Uint8Array(32),
              index: 0,
            }),
          }),
        ],
      }),
    }))
    mockGetUtxoSigningInputs.mockImplementation(() => [planner()])

    mockBuildSendKeysignPayload.mockImplementation(async ({ amount, coin, sendMaxAmount, walletCore, publicKey }) =>
      refineKeysignUtxo({
        keysignPayload: create(KeysignPayloadSchema, {
          coin: { ...coin, isNativeToken: true },
          toAddress: 'bc1qreceiver',
          toAmount: amount.toString(),
          blockchainSpecific: {
            case: 'utxoSpecific',
            value: create(UTXOSpecificSchema, {
              byteFee: '1',
              sendMaxAmount,
            }),
          },
          utxoInfo: [{ hash: '00'.repeat(32), amount: balance, index: 0 }],
        }),
        walletCore,
        publicKey,
      })
    )
    mockGetPublicKey.mockReturnValue({ data: () => new Uint8Array(33) })
    mockIsValidRecipient.mockReturnValue(true)

    const walletCore = {
      HexCoding: { encode: vi.fn(() => '00'.repeat(32)) },
    }
    const transactionBuilder = new TransactionBuilder(
      {
        name: 'Test Vault',
        publicKeys: { ecdsa: '02ecdsa-public-key', eddsa: 'eddsa-public-key' },
        hexChainCode: 'deadbeef',
        signers: ['iPhone-A1B2'],
        localPartyId: 'iPhone-A1B2',
        createdAt: 0,
        libType: 'DKLS',
        isBackedUp: true,
        order: 0,
        keyShares: { ecdsa: '', eddsa: '' },
      },
      { getWalletCore: vi.fn().mockResolvedValue(walletCore) } as never
    )
    const bitcoinCoin = {
      chain: Chain.Bitcoin,
      address: 'bc1qsender',
      decimals: 8,
      ticker: 'BTC',
    }
    const stub = {
      resolveTokenInfo: () => ({
        decimals: 8,
        ticker: 'BTC',
        contractAddress: undefined,
      }),
      buildAccountCoin: () => bitcoinCoin,
      address: async () => bitcoinCoin.address,
      parseAmount: () => requestedAmount,
      prepareSendTx: transactionBuilder.prepareSendTx.bind(transactionBuilder),
      transactionBuilder,
    }

    const sendPromise = VaultBase.prototype.send.call(stub as never, {
      chain: Chain.Bitcoin,
      to: 'bc1qreceiver',
      amount: '0.001',
      dryRun: true,
    })
    await expect(sendPromise).rejects.toMatchObject({
      code: VaultErrorCode.InvalidAmount,
      message: 'Failed to build transaction: insufficient balance (requested 0.001 BTC, available 0.00012621 BTC)',
    })
    expect(planner).toHaveBeenCalledTimes(1)
    expect(mockBuildSendKeysignPayload).toHaveBeenCalledWith(expect.objectContaining({ sendMaxAmount: false }))
  })
})
