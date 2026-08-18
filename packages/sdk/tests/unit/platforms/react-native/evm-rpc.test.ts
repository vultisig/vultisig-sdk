import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendRawTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
}))

vi.mock('viem', async importOriginal => {
  const actual = await importOriginal<typeof import('viem')>()

  return {
    ...actual,
    createPublicClient: () => mocks,
    http: vi.fn(() => ({})),
  }
})

import { keccak256 } from 'viem'

import { broadcastEvmRawTx } from '../../../../src/platforms/react-native/chains/evm/rpc'

const RPC_URL = 'http://127.0.0.1:8545'
const RAW_TX = '0x010203' as const
const TX_HASH = keccak256(RAW_TX)

describe('React Native EVM raw broadcast idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the deterministic hash instead of trusting the RPC hash after an ordinary success', async () => {
    const rpcHash = `0x${'ab'.repeat(32)}` as const
    mocks.sendRawTransaction.mockResolvedValue(rpcHash)

    await expect(broadcastEvmRawTx(RPC_URL, EvmChain.Ethereum, RAW_TX)).resolves.toBe(TX_HASH)
    expect(mocks.getTransactionReceipt).not.toHaveBeenCalled()
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it.each(['already known', 'transaction already exists', 'tx already in mempool'])(
    'returns the deterministic hash for the known duplicate error %s',
    async message => {
      mocks.sendRawTransaction.mockRejectedValue(new Error(message))

      await expect(broadcastEvmRawTx(RPC_URL, EvmChain.Ethereum, RAW_TX)).resolves.toBe(TX_HASH)
      expect(mocks.getTransactionReceipt).not.toHaveBeenCalled()
      expect(mocks.getTransaction).not.toHaveBeenCalled()
    }
  )

  it('returns the deterministic hash when receipt lookup confirms an ambiguous send', async () => {
    mocks.sendRawTransaction.mockRejectedValue(new Error('request timed out'))
    mocks.getTransactionReceipt.mockResolvedValue({ status: 'success', transactionHash: TX_HASH })

    await expect(broadcastEvmRawTx(RPC_URL, EvmChain.Ethereum, RAW_TX)).resolves.toBe(TX_HASH)
    expect(mocks.getTransactionReceipt).toHaveBeenCalledWith({ hash: TX_HASH })
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('falls back to transaction lookup when no receipt is available', async () => {
    mocks.sendRawTransaction.mockRejectedValue(new Error('socket closed'))
    mocks.getTransactionReceipt.mockRejectedValue(new Error('receipt not found'))
    mocks.getTransaction.mockResolvedValue({ hash: TX_HASH })

    await expect(broadcastEvmRawTx(RPC_URL, EvmChain.Ethereum, RAW_TX)).resolves.toBe(TX_HASH)
    expect(mocks.getTransaction).toHaveBeenCalledWith({ hash: TX_HASH })
  })

  it('does not accept lookup responses that identify a different transaction', async () => {
    const originalError = new Error('upstream rejected the transaction')
    const otherHash = `0x${'cd'.repeat(32)}`
    mocks.sendRawTransaction.mockRejectedValue(originalError)
    mocks.getTransactionReceipt.mockResolvedValue({ transactionHash: otherHash })
    mocks.getTransaction.mockResolvedValue({ hash: otherHash })

    await expect(broadcastEvmRawTx(RPC_URL, EvmChain.Ethereum, RAW_TX)).rejects.toBe(originalError)
  })

  it('rethrows the original send error when neither lookup confirms the transaction', async () => {
    const originalError = new Error('upstream rejected the transaction')
    mocks.sendRawTransaction.mockRejectedValue(originalError)
    mocks.getTransactionReceipt.mockResolvedValue(null)
    mocks.getTransaction.mockResolvedValue(null)

    await expect(broadcastEvmRawTx(RPC_URL, EvmChain.Ethereum, RAW_TX)).rejects.toBe(originalError)
  })
})
