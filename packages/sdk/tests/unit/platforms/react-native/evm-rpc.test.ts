import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendRawTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  getBlock: vi.fn(),
  getGasPrice: vi.fn(),
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

import { broadcastEvmRawTx, getEvmSuggestedFees } from '../../../../src/platforms/react-native/chains/evm/rpc'

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

const GWEI = 1_000_000_000n

// Regression for sdk#1178: getEvmSuggestedFees previously returned naive
// baseFee/10 with no per-chain floor, so a quiet-block RPC quote could
// collapse toward zero and sit unmined in the public mempool. It now runs
// through the SDK's own canonical clampEvmPriorityFee floor/ceiling policy.
describe('React Native getEvmSuggestedFees floor policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('floors a near-zero quiet-block priority fee on Ethereum to the 1 gwei minimum tip', async () => {
    // baseFee/10 here is far below the 1 gwei floor.
    mocks.getBlock.mockResolvedValue({ baseFeePerGas: 1_000n })

    const fees = await getEvmSuggestedFees(RPC_URL, EvmChain.Ethereum)

    expect(fees.maxPriorityFeePerGas).toBe(1n * GWEI)
    expect(fees.maxFeePerGas).toBe(1_000n * 2n + 1n * GWEI)
  })

  it('floors a near-zero quiet-block priority fee on Polygon to the 30 gwei minimum tip', async () => {
    mocks.getBlock.mockResolvedValue({ baseFeePerGas: 1_000n })

    const fees = await getEvmSuggestedFees(RPC_URL, EvmChain.Polygon)

    expect(fees.maxPriorityFeePerGas).toBe(30n * GWEI)
  })

  it('signs a zero tip on an L2 whose sequencer ignores it (Arbitrum), whatever 10% of base fee is', async () => {
    mocks.getBlock.mockResolvedValue({ baseFeePerGas: 100n * GWEI })

    const fees = await getEvmSuggestedFees(RPC_URL, EvmChain.Arbitrum)

    expect(fees.maxPriorityFeePerGas).toBe(0n)
    expect(fees.maxFeePerGas).toBe(200n * GWEI)
  })

  it('floors a near-zero tip on an OP-stack rollup (Base) to a nominal 20 wei', async () => {
    mocks.getBlock.mockResolvedValue({ baseFeePerGas: 10n })

    const fees = await getEvmSuggestedFees(RPC_URL, EvmChain.Base)

    expect(fees.maxPriorityFeePerGas).toBe(20n)
  })

  it('clamps a wildly inflated RPC-reported priority fee to the sanity ceiling', async () => {
    // 10% of an absurd base fee would blow past Ethereum's 500 gwei ceiling.
    mocks.getBlock.mockResolvedValue({ baseFeePerGas: 100_000n * GWEI })

    const fees = await getEvmSuggestedFees(RPC_URL, EvmChain.Ethereum)

    expect(fees.maxPriorityFeePerGas).toBe(500n * GWEI)
  })

  it('falls back to getGasPrice when the block has no baseFeePerGas', async () => {
    mocks.getBlock.mockResolvedValue({ baseFeePerGas: null })
    mocks.getGasPrice.mockResolvedValue(50n * GWEI)

    const fees = await getEvmSuggestedFees(RPC_URL, EvmChain.Arbitrum)

    expect(fees.baseFeePerGas).toBe(50n * GWEI)
    expect(mocks.getGasPrice).toHaveBeenCalledOnce()
  })
})
