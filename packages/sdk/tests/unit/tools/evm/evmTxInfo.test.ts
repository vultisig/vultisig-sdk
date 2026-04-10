import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetTransactionCount = vi.fn()
const mockGetBlock = vi.fn()
const mockEstimateMaxPriorityFeePerGas = vi.fn()
const mockGetChainId = vi.fn()
const mockEstimateGas = vi.fn()

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({
    getTransactionCount: mockGetTransactionCount,
    getBlock: mockGetBlock,
    estimateMaxPriorityFeePerGas: mockEstimateMaxPriorityFeePerGas,
    getChainId: mockGetChainId,
    estimateGas: mockEstimateGas,
  }),
}))

import { evmTxInfo } from '@/tools/evm/evmTxInfo'

describe('evmTxInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTransactionCount.mockResolvedValue(42)
    mockGetBlock.mockResolvedValue({ baseFeePerGas: 30000000000n })
    mockEstimateMaxPriorityFeePerGas.mockResolvedValue(1500000000n)
    mockGetChainId.mockResolvedValue(1)
  })

  it('returns nonce, gas prices, and chainId', async () => {
    const result = await evmTxInfo('Ethereum', {
      address: '0x000000000000000000000000000000000000dEaD',
    })

    expect(result.nonce).toBe(42)
    expect(result.baseFeePerGas).toBe(30000000000n)
    expect(result.maxPriorityFeePerGas).toBe(1500000000n)
    expect(result.suggestedMaxFeePerGas).toBe(30000000000n * 2n + 1500000000n)
    expect(result.chainId).toBe(1)
    expect(result.estimatedGas).toBeUndefined()
  })

  it('estimates gas when to address is provided', async () => {
    mockEstimateGas.mockResolvedValue(21000n)

    const result = await evmTxInfo('Ethereum', {
      address: '0x000000000000000000000000000000000000dEaD',
      to: '0x0000000000000000000000000000000000000001',
      value: 1000000000000000000n,
    })

    expect(result.estimatedGas).toBe(21000n)
    expect(mockEstimateGas).toHaveBeenCalledWith({
      account: '0x000000000000000000000000000000000000dEaD',
      to: '0x0000000000000000000000000000000000000001',
      data: undefined,
      value: 1000000000000000000n,
    })
  })

  it('handles chains without baseFee (pre-EIP-1559)', async () => {
    mockGetBlock.mockResolvedValue({ baseFeePerGas: null })

    const result = await evmTxInfo('BSC', {
      address: '0x000000000000000000000000000000000000dEaD',
    })

    expect(result.baseFeePerGas).toBe(0n)
  })
})
