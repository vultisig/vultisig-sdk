import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  client: {
    getFeeHistory: vi.fn(),
    getGasPrice: vi.fn(),
    estimateMaxPriorityFeePerGas: vi.fn(),
  },
  getEvmClient: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: mocks.getEvmClient,
}))

import { getEvmMaxPriorityFeePerGas } from './maxPriorityFeePerGas'

describe('getEvmMaxPriorityFeePerGas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEvmClient.mockReturnValue(mocks.client)
    mocks.client.getFeeHistory.mockResolvedValue({ reward: [[5n], [9n], [3n]] })
    mocks.client.getGasPrice.mockResolvedValue(100n)
    mocks.client.estimateMaxPriorityFeePerGas.mockResolvedValue(7n)
  })

  it('takes the highest 5th-percentile tip of the last ten blocks', async () => {
    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Ethereum)).resolves.toBe(9n)
    expect(mocks.client.getFeeHistory).toHaveBeenCalledWith({ blockCount: 10, rewardPercentiles: [5] })
    expect(mocks.client.estimateMaxPriorityFeePerGas).not.toHaveBeenCalled()
  })

  it('never exceeds the current gas price', async () => {
    mocks.client.getGasPrice.mockResolvedValue(4n)

    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Ethereum)).resolves.toBe(4n)
  })

  it.each([
    ['no reward field', {}],
    ['empty rewards', { reward: [] }],
    ['blocks without a reward entry', { reward: [[], []] }],
  ])('falls back to the node suggestion when the history carries %s', async (_label, feeHistory) => {
    mocks.client.getFeeHistory.mockResolvedValue(feeHistory)

    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Ethereum)).resolves.toBe(7n)
  })

  it('falls back to the node suggestion when fee history is unsupported', async () => {
    mocks.client.getFeeHistory.mockRejectedValue(new Error('method not found'))

    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Ethereum)).resolves.toBe(7n)
  })
})
