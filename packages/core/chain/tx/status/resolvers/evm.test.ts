import { TransactionNotFoundError, TransactionReceiptNotFoundError } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({
    getTransactionReceipt: mocks.getTransactionReceipt,
    getTransaction: mocks.getTransaction,
  }),
}))

import { Chain } from '../../../Chain'
import { getEvmTxStatus } from './evm'

describe('getEvmTxStatus', () => {
  const hash = '0xabc123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a transient pending (isKnown:false) when the receipt RPC fails', async () => {
    mocks.getTransactionReceipt.mockRejectedValue(new Error('rpc down'))
    mocks.getTransaction.mockRejectedValue(new Error('rpc down'))

    const result = await getEvmTxStatus({ chain: Chain.Ethereum, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
    // A transient receipt error must NOT trigger the not-found probe.
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('returns a true pending (isKnown:true) when the receipt is absent but the node knows the tx', async () => {
    mocks.getTransactionReceipt.mockRejectedValue(new TransactionReceiptNotFoundError({ hash: hash as `0x${string}` }))
    mocks.getTransaction.mockResolvedValue({ hash, blockNumber: null })

    const result = await getEvmTxStatus({ chain: Chain.Ethereum, hash })
    expect(result).toEqual({ status: 'pending', isKnown: true })
  })

  it('returns not_found when the node has never seen the hash', async () => {
    mocks.getTransactionReceipt.mockRejectedValue(new TransactionReceiptNotFoundError({ hash: hash as `0x${string}` }))
    mocks.getTransaction.mockRejectedValue(new TransactionNotFoundError({ hash: hash as `0x${string}` }))

    const result = await getEvmTxStatus({ chain: Chain.Ethereum, hash })
    expect(result).toEqual({ status: 'not_found', isKnown: false })
  })

  it('returns not_found when getTransaction resolves null (never-seen hash)', async () => {
    mocks.getTransactionReceipt.mockResolvedValue(null)
    mocks.getTransaction.mockResolvedValue(null)

    const result = await getEvmTxStatus({ chain: Chain.Ethereum, hash })
    expect(result).toEqual({ status: 'not_found', isKnown: false })
  })

  it('stays pending (isKnown:false) when the not-found probe itself fails transiently', async () => {
    mocks.getTransactionReceipt.mockResolvedValue(null)
    mocks.getTransaction.mockRejectedValue(new Error('rpc down'))

    const result = await getEvmTxStatus({ chain: Chain.Ethereum, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns success with fee receipt when the tx succeeded', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      status: 'success',
      gasUsed: 21_000n,
      effectiveGasPrice: 2_000_000_000n,
    })

    const result = await getEvmTxStatus({ chain: Chain.Ethereum, hash })
    expect(result).toEqual({
      status: 'success',
      receipt: {
        feeAmount: 42_000_000_000_000n,
        feeDecimals: 18,
        feeTicker: 'ETH',
      },
    })
    // A confirmed receipt must short-circuit before the not-found probe.
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('returns error when the tx reverted on-chain', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      gasUsed: 21_000n,
      effectiveGasPrice: 2_000_000_000n,
    })

    const result = await getEvmTxStatus({ chain: Chain.Ethereum, hash })
    expect(result.status).toBe('error')
  })
})
