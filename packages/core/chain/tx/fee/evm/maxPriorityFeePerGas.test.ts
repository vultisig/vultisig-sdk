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

import { getEvmMaxPriorityFeePerGas, getEvmSigningPriorityFee } from './maxPriorityFeePerGas'

const gwei = 1_000_000_000n
const milligwei = (n: number) => BigInt(n) * 1_000_000n
const rewardHistory = (rewards: bigint[]) => ({ reward: rewards.map(reward => [reward]) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getEvmClient.mockReturnValue(mocks.client)
  mocks.client.getFeeHistory.mockResolvedValue({ reward: [[5n], [9n], [3n]] })
  mocks.client.getGasPrice.mockResolvedValue(100n)
  mocks.client.estimateMaxPriorityFeePerGas.mockResolvedValue(7n)
})

describe('getEvmMaxPriorityFeePerGas', () => {
  it('takes the highest 5th-percentile tip of the last ten blocks', async () => {
    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Polygon)).resolves.toBe(9n)
    expect(mocks.client.getFeeHistory).toHaveBeenCalledWith({ blockCount: 10, rewardPercentiles: [5] })
    expect(mocks.client.estimateMaxPriorityFeePerGas).not.toHaveBeenCalled()
  })

  it('never exceeds the current gas price', async () => {
    mocks.client.getGasPrice.mockResolvedValue(4n)

    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Polygon)).resolves.toBe(4n)
  })

  it('leaves the tip uncapped instead of failing when the gas price lookup fails', async () => {
    mocks.client.getGasPrice.mockRejectedValue(new Error('upstream timeout'))

    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Polygon)).resolves.toBe(9n)
  })

  it.each([
    ['no reward field', {}],
    ['empty rewards', { reward: [] }],
    ['blocks without a reward entry', { reward: [[], []] }],
  ])('falls back to the node suggestion when the history carries %s', async (_label, feeHistory) => {
    mocks.client.getFeeHistory.mockResolvedValue(feeHistory)

    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Polygon)).resolves.toBe(7n)
  })

  it('falls back to the node suggestion when fee history is unsupported', async () => {
    mocks.client.getFeeHistory.mockRejectedValue(new Error('method not found'))

    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Polygon)).resolves.toBe(7n)
  })

  it('takes the median 75th-percentile tip of the last ten Ethereum blocks', async () => {
    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Ethereum)).resolves.toBe(5n)
    expect(mocks.client.getFeeHistory).toHaveBeenCalledWith({ blockCount: 10, rewardPercentiles: [75] })
  })

  it('averages the two middle Ethereum tips of an even history, rounding down', async () => {
    mocks.client.getFeeHistory.mockResolvedValue(rewardHistory([40n, 10n, 20n, 25n]))

    await expect(getEvmMaxPriorityFeePerGas(EvmChain.Ethereum)).resolves.toBe(22n)
  })
})

describe('getEvmSigningPriorityFee', () => {
  beforeEach(() => {
    mocks.client.getGasPrice.mockResolvedValue(100n * gwei)
  })

  it.each([
    ['a send', false, milligwei(15), milligwei(200)],
    ['a send', false, milligwei(310), milligwei(310)],
    ['a swap', true, milligwei(100), milligwei(500)],
    ['a swap', true, milligwei(700), milligwei(700)],
  ])('signs %s on Ethereum at max(median p75, floor): median %s', async (_label, isSwap, median, expected) => {
    mocks.client.getFeeHistory.mockResolvedValue(rewardHistory([median - 1n, median, median + 1n]))

    await expect(getEvmSigningPriorityFee({ chain: EvmChain.Ethereum, isSwap })).resolves.toBe(expected)
  })

  it.each([
    ['fails', () => mocks.client.getFeeHistory.mockRejectedValue(new Error('method not found'))],
    ['carries no rewards', () => mocks.client.getFeeHistory.mockResolvedValue({ reward: [] })],
  ])('keeps the 1 gwei Ethereum floor when fee history %s', async (_label, arrange) => {
    arrange()
    mocks.client.estimateMaxPriorityFeePerGas.mockResolvedValue(milligwei(15))

    await expect(getEvmSigningPriorityFee({ chain: EvmChain.Ethereum, isSwap: false })).resolves.toBe(gwei)
    await expect(getEvmSigningPriorityFee({ chain: EvmChain.Ethereum, isSwap: true })).resolves.toBe(gwei)
  })

  it.each([
    [milligwei(300), milligwei(300)],
    [milligwei(100), milligwei(200)],
  ])('caps an Ethereum market tip at a %s gas price, then floors it', async (gasPrice, expected) => {
    mocks.client.getFeeHistory.mockResolvedValue(rewardHistory([2n * gwei]))
    mocks.client.getGasPrice.mockResolvedValue(gasPrice)

    await expect(getEvmSigningPriorityFee({ chain: EvmChain.Ethereum, isSwap: false })).resolves.toBe(expected)
  })

  it('keeps the 500 gwei ceiling on an Ethereum market tip', async () => {
    mocks.client.getFeeHistory.mockResolvedValue(rewardHistory([10_000n * gwei]))
    mocks.client.getGasPrice.mockResolvedValue(20_000n * gwei)

    await expect(getEvmSigningPriorityFee({ chain: EvmChain.Ethereum, isSwap: true })).resolves.toBe(500n * gwei)
  })

  it.each([
    [EvmChain.Polygon, false, 30n * gwei],
    [EvmChain.Polygon, true, 30n * gwei],
    [EvmChain.BSC, true, gwei],
    [EvmChain.Base, true, 20n],
    [EvmChain.Avalanche, true, 9n],
  ])('clamps the highest 5th-percentile tip on %s exactly as before (swap: %s)', async (chain, isSwap, expected) => {
    await expect(getEvmSigningPriorityFee({ chain, isSwap })).resolves.toBe(expected)
    expect(mocks.client.getFeeHistory).toHaveBeenCalledWith({ blockCount: 10, rewardPercentiles: [5] })
  })
})
