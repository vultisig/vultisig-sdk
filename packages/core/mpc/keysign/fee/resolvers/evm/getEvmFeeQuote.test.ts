import { EvmChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const client = {
    estimateGas: vi.fn(),
    extend: vi.fn(),
  }

  return {
    client,
    zksyncFeeClient: {
      estimateFee: vi.fn(),
    },
    getEvmClient: vi.fn(),
    getEvmBaseFee: vi.fn(),
    getEvmMaxPriorityFeePerGas: vi.fn(),
    getKeysignAmount: vi.fn(),
    getKeysignCoin: vi.fn(),
    getKeysignSwapPayload: vi.fn(),
  }
})

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: mocks.getEvmClient,
}))

vi.mock('@vultisig/core-chain/tx/fee/evm/baseFee', () => ({
  getEvmBaseFee: mocks.getEvmBaseFee,
}))

vi.mock('@vultisig/core-chain/tx/fee/evm/maxPriorityFeePerGas', () => ({
  getEvmMaxPriorityFeePerGas: mocks.getEvmMaxPriorityFeePerGas,
}))

vi.mock('@vultisig/core-mpc/keysign/swap/getKeysignSwapPayload', () => ({
  getKeysignSwapPayload: mocks.getKeysignSwapPayload,
}))

vi.mock('@vultisig/core-mpc/keysign/utils/getKeysignAmount', () => ({
  getKeysignAmount: mocks.getKeysignAmount,
}))

vi.mock('@vultisig/core-mpc/keysign/utils/getKeysignCoin', () => ({
  getKeysignCoin: mocks.getKeysignCoin,
}))

import { getEvmFeeQuote } from './getEvmFeeQuote'

const account = '0x1111111111111111111111111111111111111111'
const router = '0x2222222222222222222222222222222222222222'

const makeCoin = (chain: EvmChain = EvmChain.Ethereum) => ({
  chain,
  address: account,
})

const makeGeneralSwapPayload = () => ({
  general: {
    quote: {
      tx: {
        to: router,
        data: '0xabcdef',
        value: '0',
      },
    },
  },
})

describe('getEvmFeeQuote gas limit buffering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEvmClient.mockReturnValue(mocks.client)
    mocks.getEvmBaseFee.mockResolvedValue(100n)
    mocks.getEvmMaxPriorityFeePerGas.mockResolvedValue(2n)
    mocks.getKeysignAmount.mockReturnValue(1n)
    mocks.getKeysignCoin.mockReturnValue(makeCoin())
    mocks.getKeysignSwapPayload.mockReturnValue(makeGeneralSwapPayload())
    mocks.client.estimateGas.mockResolvedValue(700_001n)
    mocks.client.extend.mockReturnValue(mocks.zksyncFeeClient)
    mocks.zksyncFeeClient.estimateFee.mockResolvedValue({
      gasLimit: 700_001n,
      maxFeePerGas: 1000n,
      maxPriorityFeePerGas: 3n,
    })
  })

  it('buffers the fallback floor for general swaps when gas estimation fails', async () => {
    mocks.client.estimateGas.mockRejectedValueOnce(new Error('TransferHelper: TRANSFER_FROM_FAILED'))

    const quote = await getEvmFeeQuote({
      keysignPayload: {} as never,
      minimumGasLimit: 600_000n,
    })

    expect(quote.gasLimit).toBe(900_000n)
    expect(quote.baseFeePerGas).toBe(150n)
    expect(quote.maxPriorityFeePerGas).toBe(2n)
  })

  it('ceil-rounds buffered successful estimates for general swaps', async () => {
    const quote = await getEvmFeeQuote({
      keysignPayload: {} as never,
      minimumGasLimit: 600_000n,
    })

    expect(quote.gasLimit).toBe(1_050_002n)
  })

  it('buffers the capped third-party swap gas limit when it is the largest source', async () => {
    const quote = await getEvmFeeQuote({
      keysignPayload: {} as never,
      thirdPartyGasLimitEstimation: 800_000n,
      minimumGasLimit: 600_000n,
    })

    expect(quote.gasLimit).toBe(1_200_000n)
  })

  it('buffers data-bearing fallback gas limits without a swap payload', async () => {
    mocks.getKeysignSwapPayload.mockReturnValue(undefined)
    mocks.client.estimateGas.mockRejectedValueOnce(new Error('execution reverted'))

    const quote = await getEvmFeeQuote({
      keysignPayload: {
        toAddress: router,
        memo: '0xabcdef',
      } as never,
      minimumGasLimit: 600_000n,
    })

    expect(quote.gasLimit).toBe(900_000n)
  })

  it('does not buffer simple transfer fallback gas limits', async () => {
    mocks.getKeysignSwapPayload.mockReturnValue(undefined)
    mocks.client.estimateGas.mockRejectedValueOnce(new Error('execution reverted'))

    const quote = await getEvmFeeQuote({
      keysignPayload: {
        toAddress: router,
      } as never,
      minimumGasLimit: 600_000n,
    })

    expect(quote.gasLimit).toBe(600_000n)
  })

  it('honors explicit fee settings without applying the swap buffer', async () => {
    const quote = await getEvmFeeQuote({
      keysignPayload: {} as never,
      feeSettings: {
        gasLimit: 600_000n,
        maxPriorityFeePerGas: 2n,
      },
      minimumGasLimit: 600_000n,
    })

    expect(quote.gasLimit).toBe(600_000n)
    expect(mocks.client.estimateGas).not.toHaveBeenCalled()
  })

  it('keeps Mantle swap gas limits at the existing special floor', async () => {
    mocks.getKeysignCoin.mockReturnValue(makeCoin(EvmChain.Mantle))
    mocks.client.estimateGas.mockRejectedValueOnce(new Error('execution reverted'))

    const quote = await getEvmFeeQuote({
      keysignPayload: {} as never,
      minimumGasLimit: 3_000_000_000n,
    })

    expect(quote.gasLimit).toBe(3_000_000_000n)
  })

  it('buffers ZkSync fee estimates while preserving its fee-field calculation', async () => {
    mocks.getKeysignCoin.mockReturnValue(makeCoin(EvmChain.Zksync))

    const quote = await getEvmFeeQuote({
      keysignPayload: {} as never,
      minimumGasLimit: 600_000n,
    })

    expect(quote.gasLimit).toBe(1_050_002n)
    expect(quote.baseFeePerGas).toBe(997n)
    expect(quote.maxPriorityFeePerGas).toBe(3n)
    expect(mocks.getEvmBaseFee).not.toHaveBeenCalled()
  })
})
