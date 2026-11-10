import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  client: {
    getFeeHistory: vi.fn(),
    getGasPrice: vi.fn(),
    estimateMaxPriorityFeePerGas: vi.fn(),
  },
  getEvmBaseFee: vi.fn(),
  getEvmGasPrice: vi.fn(),
}))

vi.mock('./baseFee', () => ({ getEvmBaseFee: mocks.getEvmBaseFee }))
vi.mock('./gasPrice', () => ({ getEvmGasPrice: mocks.getEvmGasPrice }))
vi.mock('@vultisig/core-chain/chains/evm/client', () => ({ getEvmClient: () => mocks.client }))

import { getEvmRouterDepositFee } from './getEvmRouterDepositFee'

describe('getEvmRouterDepositFee', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEvmBaseFee.mockResolvedValue(100n)
    mocks.getEvmGasPrice.mockResolvedValue(90n)
    mocks.client.getFeeHistory.mockRejectedValue(new Error('method not found'))
    mocks.client.getGasPrice.mockResolvedValue(100_000_000_000n)
    mocks.client.estimateMaxPriorityFeePerGas.mockResolvedValue(2n)
  })

  it('prices an enveloped router deposit with base-fee headroom and a clamped priority fee', async () => {
    const result = await getEvmRouterDepositFee(EvmChain.Ethereum)

    expect(result).toEqual({
      gasLimit: 120_000n,
      baseFeePerGas: 120n,
      maxPriorityFeePerGas: 1_000_000_000n,
      fee: 120_000n * (120n + 1_000_000_000n),
    })
    expect(mocks.getEvmGasPrice).not.toHaveBeenCalled()
  })

  it('floors an Ethereum market tip at the 0.5 gwei swap floor', async () => {
    mocks.client.getFeeHistory.mockResolvedValue({ reward: [[100_000_000n], [100_000_000n]] })

    const result = await getEvmRouterDepositFee(EvmChain.Ethereum)

    expect(result.maxPriorityFeePerGas).toBe(500_000_000n)
    expect(result.fee).toBe(120_000n * (120n + 500_000_000n))
  })

  it('prices a legacy router deposit from gas price without a priority fee', async () => {
    const result = await getEvmRouterDepositFee(EvmChain.BSC)

    expect(result).toEqual({
      gasLimit: 120_000n,
      baseFeePerGas: 90n,
      maxPriorityFeePerGas: 0n,
      fee: 10_800_000n,
    })
    expect(mocks.getEvmBaseFee).not.toHaveBeenCalled()
    expect(mocks.client.getFeeHistory).not.toHaveBeenCalled()
  })
})
