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

  it('prefers the pending block tag so an external wallet in-flight tx is counted', async () => {
    // sdk#144: 'latest' alone only reflects confirmed txs, so a not-yet-mined
    // tx from e.g. MetaMask can hand out an already-used nonce.
    mockGetTransactionCount.mockResolvedValueOnce(43)
    const result = await evmTxInfo('Ethereum', {
      address: '0x000000000000000000000000000000000000dEaD',
    })

    expect(result.nonce).toBe(43)
    expect(mockGetTransactionCount).toHaveBeenCalledWith({
      address: '0x000000000000000000000000000000000000dEaD',
      blockTag: 'pending',
    })
    expect(mockGetTransactionCount).not.toHaveBeenCalledWith(expect.objectContaining({ blockTag: 'latest' }))
  })

  it('falls back to the latest block tag on chains that reject the pending tag', async () => {
    mockGetTransactionCount.mockRejectedValueOnce(new Error('pending tag unsupported')).mockResolvedValueOnce(7)

    const result = await evmTxInfo('Ethereum', {
      address: '0x000000000000000000000000000000000000dEaD',
    })

    expect(result.nonce).toBe(7)
    expect(mockGetTransactionCount).toHaveBeenNthCalledWith(1, {
      address: '0x000000000000000000000000000000000000dEaD',
      blockTag: 'pending',
    })
    expect(mockGetTransactionCount).toHaveBeenNthCalledWith(2, {
      address: '0x000000000000000000000000000000000000dEaD',
      blockTag: 'latest',
    })
  })
  it.each(['request timed out', 'rate limit exceeded', 'internal server error'])(
    'propagates %s without a confirmed-nonce fallback',
    async message => {
      const error = new Error(message)
      mockGetTransactionCount.mockRejectedValueOnce(error)
      await expect(
        evmTxInfo('Ethereum', {
          address: '0x000000000000000000000000000000000000dEaD',
        })
      ).rejects.toBe(error)
      expect(mockGetTransactionCount).toHaveBeenCalledTimes(1)
    }
  )

  it('recognizes explicit pending-tag rejection in a wrapped RPC cause', async () => {
    const error = new Error('RPC request failed', {
      cause: new Error('unsupported block tag: pending'),
    })
    mockGetTransactionCount.mockRejectedValueOnce(error).mockResolvedValueOnce(7)
    const result = await evmTxInfo('Ethereum', {
      address: '0x000000000000000000000000000000000000dEaD',
    })
    expect(result.nonce).toBe(7)
    expect(mockGetTransactionCount).toHaveBeenCalledTimes(2)
  })
})
