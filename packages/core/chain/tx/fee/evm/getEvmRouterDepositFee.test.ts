import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getEvmBaseFee: vi.fn(),
  getEvmGasPrice: vi.fn(),
  getEvmMaxPriorityFeePerGas: vi.fn(),
}))

vi.mock('./baseFee', () => ({ getEvmBaseFee: mocks.getEvmBaseFee }))
vi.mock('./gasPrice', () => ({ getEvmGasPrice: mocks.getEvmGasPrice }))
vi.mock('./maxPriorityFeePerGas', () => ({
  getEvmMaxPriorityFeePerGas: mocks.getEvmMaxPriorityFeePerGas,
}))

import { getEvmRouterDepositFee } from './getEvmRouterDepositFee'

describe('getEvmRouterDepositFee', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEvmBaseFee.mockResolvedValue(100n)
    mocks.getEvmGasPrice.mockResolvedValue(90n)
    mocks.getEvmMaxPriorityFeePerGas.mockResolvedValue(2n)
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

  it('prices a legacy router deposit from gas price without a priority fee', async () => {
    const result = await getEvmRouterDepositFee(EvmChain.BSC)

    expect(result).toEqual({
      gasLimit: 120_000n,
      baseFeePerGas: 90n,
      maxPriorityFeePerGas: 0n,
      fee: 10_800_000n,
    })
    expect(mocks.getEvmBaseFee).not.toHaveBeenCalled()
    expect(mocks.getEvmMaxPriorityFeePerGas).not.toHaveBeenCalled()
  })
})
