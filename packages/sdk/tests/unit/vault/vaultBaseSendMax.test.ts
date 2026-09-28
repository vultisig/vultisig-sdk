import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

const { mockGetSendFeeEstimate, mockGetPublicKey, mockIsValidRecipient } = vi.hoisted(() => ({
  mockGetSendFeeEstimate: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockIsValidRecipient: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/send/getSendFeeEstimate', () => ({
  getSendFeeEstimate: mockGetSendFeeEstimate,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@vultisig/core-chain/utils/isValidRecipient', () => ({
  isValidRecipient: mockIsValidRecipient,
}))
vi.mock('@vultisig/mpc-types', () => ({ getMpcEngine: vi.fn() }))

import { VaultBase } from '@/vault/VaultBase'

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
})
