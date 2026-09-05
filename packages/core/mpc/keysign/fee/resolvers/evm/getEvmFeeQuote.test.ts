import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    getEvmGasPrice: vi.fn(),
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

vi.mock('@vultisig/core-chain/tx/fee/evm/gasPrice', () => ({
  getEvmGasPrice: mocks.getEvmGasPrice,
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

const gwei = 1_000_000_000n
const account = '0x1111111111111111111111111111111111111111'
const router = '0x2222222222222222222222222222222222222222'
const token = '0x3333333333333333333333333333333333333333'

const makeCoin = (chain: EvmChain = EvmChain.Ethereum, id?: string) => ({
  chain,
  address: account,
  id,
})

const generalSwapPayload = {
  general: {
    quote: {
      tx: {
        to: router,
        data: '0xabcdef',
        value: '0',
      },
    },
  },
}

const nativeSwapPayload = {
  native: {
    chain: 'THORChain',
  },
}

const emptyPayload = {} as never
const transferPayload = { toAddress: router } as never
const contractCallPayload = { toAddress: router, memo: '0xabcdef' } as never

describe('getEvmFeeQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEvmClient.mockReturnValue(mocks.client)
    mocks.getEvmBaseFee.mockResolvedValue(100n)
    mocks.getEvmGasPrice.mockResolvedValue(1_000n)
    mocks.getEvmMaxPriorityFeePerGas.mockResolvedValue(2n)
    mocks.getKeysignAmount.mockReturnValue(1n)
    mocks.getKeysignCoin.mockReturnValue(makeCoin())
    mocks.getKeysignSwapPayload.mockReturnValue(undefined)
    mocks.client.estimateGas.mockResolvedValue(310_252n)
    mocks.client.extend.mockReturnValue(mocks.zksyncFeeClient)
    mocks.zksyncFeeClient.estimateFee.mockResolvedValue({
      gasLimit: 700_001n,
      maxFeePerGas: 1000n,
      maxPriorityFeePerGas: 3n,
    })
  })

  describe('aggregator swap', () => {
    beforeEach(() => {
      mocks.getKeysignSwapPayload.mockReturnValue(generalSwapPayload)
    })

    it('signs the larger of the route gas and the inflated simulation', async () => {
      const quote = await getEvmFeeQuote({
        keysignPayload: emptyPayload,
        thirdPartyGasLimitEstimation: 300_000n,
      })

      expect(quote.gasLimit).toBe(465_378n)
      expect(mocks.client.estimateGas).toHaveBeenCalledWith(
        expect.objectContaining({ to: router, data: '0xabcdef', value: 0n })
      )
    })

    it('keeps the route gas when it exceeds the inflated simulation', async () => {
      const quote = await getEvmFeeQuote({
        keysignPayload: emptyPayload,
        thirdPartyGasLimitEstimation: 500_000n,
      })

      expect(quote.gasLimit).toBe(500_000n)
    })

    it('counts a route without a gas figure as the swap default', async () => {
      const quote = await getEvmFeeQuote({ keysignPayload: emptyPayload })

      expect(quote.gasLimit).toBe(600_000n)
    })

    it('inflates the swap default when the route cannot be simulated', async () => {
      mocks.client.estimateGas.mockRejectedValueOnce(new Error('TransferHelper: TRANSFER_FROM_FAILED'))

      const quote = await getEvmFeeQuote({
        keysignPayload: emptyPayload,
        thirdPartyGasLimitEstimation: 300_000n,
      })

      expect(quote.gasLimit).toBe(900_000n)
    })

    it('sizes a token route from its gas and the inflated default without simulating it', async () => {
      mocks.getKeysignCoin.mockReturnValue(makeCoin(EvmChain.Ethereum, token))

      const quote = await getEvmFeeQuote({
        keysignPayload: emptyPayload,
        thirdPartyGasLimitEstimation: 300_000n,
      })

      expect(quote.gasLimit).toBe(900_000n)
      expect(mocks.client.estimateGas).not.toHaveBeenCalled()
    })

    it('prices the base fee with 32% headroom and floors the tip', async () => {
      const quote = await getEvmFeeQuote({ keysignPayload: emptyPayload })

      expect(quote.baseFeePerGas).toBe(132n)
      // 2 wei RPC tip is floored to 1 gwei on Ethereum
      expect(quote.maxPriorityFeePerGas).toBe(1n * gwei)
    })

    it('inflates the Mantle swap default and signs a zero tip', async () => {
      mocks.getKeysignCoin.mockReturnValue(makeCoin(EvmChain.Mantle))
      mocks.client.estimateGas.mockRejectedValueOnce(new Error('execution reverted'))

      const quote = await getEvmFeeQuote({ keysignPayload: emptyPayload })

      expect(quote.gasLimit).toBe(4_500_000_000n)
      expect(quote.maxPriorityFeePerGas).toBe(0n)
    })

    it('prices a legacy-fee chain from its gas price with 10% headroom and no tip', async () => {
      mocks.getKeysignCoin.mockReturnValue(makeCoin(EvmChain.BSC))

      const quote = await getEvmFeeQuote({ keysignPayload: emptyPayload })

      expect(quote.baseFeePerGas).toBe(1_100n)
      expect(quote.maxPriorityFeePerGas).toBe(0n)
      expect(mocks.getEvmBaseFee).not.toHaveBeenCalled()
      expect(mocks.getEvmMaxPriorityFeePerGas).not.toHaveBeenCalled()
    })
  })

  describe('router deposit', () => {
    beforeEach(() => {
      mocks.getKeysignSwapPayload.mockReturnValue(nativeSwapPayload)
    })

    it('signs the fixed deposit limit with transfer pricing and no simulation', async () => {
      const quote = await getEvmFeeQuote({
        keysignPayload: { toAddress: router, memo: '=:ETH.ETH:0x4444' } as never,
      })

      expect(quote.gasLimit).toBe(120_000n)
      expect(quote.baseFeePerGas).toBe(120n)
      expect(mocks.client.estimateGas).not.toHaveBeenCalled()
    })
  })

  describe('transfer', () => {
    it('signs the simulated cost when it exceeds the chain floor', async () => {
      mocks.client.estimateGas.mockResolvedValue(30_000n)

      const quote = await getEvmFeeQuote({ keysignPayload: transferPayload })

      expect(quote.gasLimit).toBe(30_000n)
      expect(quote.baseFeePerGas).toBe(120n)
    })

    it('raises a low simulation to the chain floor without inflating a memo send', async () => {
      mocks.client.estimateGas.mockResolvedValue(21_000n)

      const quote = await getEvmFeeQuote({
        keysignPayload: { toAddress: router, memo: 'hello' } as never,
      })

      expect(quote.gasLimit).toBe(23_000n)
      expect(mocks.client.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ data: '0x68656c6c6f' }))
    })

    it('falls back to the chain floor when simulation fails', async () => {
      mocks.client.estimateGas.mockRejectedValueOnce(new Error('execution reverted'))

      const quote = await getEvmFeeQuote({ keysignPayload: transferPayload })

      expect(quote.gasLimit).toBe(23_000n)
    })

    it('floors a token transfer at the ERC-20 default and simulates the transfer call', async () => {
      mocks.getKeysignCoin.mockReturnValue(makeCoin(EvmChain.Ethereum, token))
      mocks.client.estimateGas.mockResolvedValue(51_000n)

      const quote = await getEvmFeeQuote({
        keysignPayload: { toAddress: router, toAmount: '1' } as never,
      })

      expect(quote.gasLimit).toBe(120_000n)
      expect(mocks.client.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ to: token, value: 0n }))
    })

    it('honors a requested gas limit above the floor', async () => {
      mocks.client.estimateGas.mockResolvedValue(21_000n)

      const quote = await getEvmFeeQuote({
        keysignPayload: transferPayload,
        thirdPartyGasLimitEstimation: 40_000n,
      })

      expect(quote.gasLimit).toBe(40_000n)
    })
  })

  describe('contract call', () => {
    it('inflates the simulated cost', async () => {
      mocks.client.estimateGas.mockResolvedValue(100_000n)

      const quote = await getEvmFeeQuote({ keysignPayload: contractCallPayload })

      expect(quote.gasLimit).toBe(150_000n)
      expect(quote.baseFeePerGas).toBe(120n)
    })

    it('inflates the contract-call default when simulation fails', async () => {
      mocks.client.estimateGas.mockRejectedValueOnce(new Error('execution reverted'))

      const quote = await getEvmFeeQuote({ keysignPayload: contractCallPayload })

      expect(quote.gasLimit).toBe(900_000n)
    })

    it('inflates the requested gas limit when it exceeds the simulation', async () => {
      mocks.client.estimateGas.mockResolvedValue(100_000n)

      const quote = await getEvmFeeQuote({
        keysignPayload: contractCallPayload,
        thirdPartyGasLimitEstimation: 200_000n,
      })

      expect(quote.gasLimit).toBe(300_000n)
    })

    it('applies a caller floor to the fallback only', async () => {
      mocks.client.estimateGas.mockResolvedValue(100_000n)

      const simulated = await getEvmFeeQuote({
        keysignPayload: contractCallPayload,
        minimumGasLimit: 800_000n,
      })

      expect(simulated.gasLimit).toBe(150_000n)

      mocks.client.estimateGas.mockRejectedValueOnce(new Error('execution reverted'))

      const fallback = await getEvmFeeQuote({
        keysignPayload: contractCallPayload,
        minimumGasLimit: 800_000n,
      })

      expect(fallback.gasLimit).toBe(1_200_000n)
    })
  })

  it('honors explicit fee settings without simulating', async () => {
    mocks.getKeysignSwapPayload.mockReturnValue(generalSwapPayload)

    const quote = await getEvmFeeQuote({
      keysignPayload: emptyPayload,
      feeSettings: {
        gasLimit: 600_000n,
        maxPriorityFeePerGas: 2n,
      },
    })

    expect(quote.gasLimit).toBe(600_000n)
    expect(quote.maxPriorityFeePerGas).toBe(2n)
    expect(quote.baseFeePerGas).toBe(132n)
    expect(mocks.client.estimateGas).not.toHaveBeenCalled()
  })

  describe('zkSync', () => {
    beforeEach(() => {
      mocks.getKeysignCoin.mockReturnValue(makeCoin(EvmChain.Zksync))
      mocks.getKeysignSwapPayload.mockReturnValue(generalSwapPayload)
    })

    it('inflates the zkSync swap estimate while preserving its fee-field calculation', async () => {
      const quote = await getEvmFeeQuote({ keysignPayload: emptyPayload })

      expect(quote.gasLimit).toBe(1_050_001n)
      expect(quote.baseFeePerGas).toBe(997n)
      expect(quote.maxPriorityFeePerGas).toBe(3n)
      expect(mocks.getEvmBaseFee).not.toHaveBeenCalled()
    })

    it('floors the ZkSync base fee at 0 for a malformed compromised-RPC tuple (maxFee < priority > ceiling) — SDK2-01 preferably-blocking', async () => {
      // The exact clamp-attack case NeOMakinG flagged on #1078: a compromised RPC
      // returns a malformed tuple where maxFeePerGas < maxPriorityFeePerGas and the
      // priority fee exceeds the 50 gwei ZkSync ceiling. baseFeePerGas is derived
      // from the RAW split (maxFee - priority), which would go negative; downstream
      // maxFeePerGas = baseFeePerGas + clamp(priority) must NOT become negative.
      mocks.zksyncFeeClient.estimateFee.mockResolvedValue({
        gasLimit: 700_001n,
        maxFeePerGas: 1n, // 1 wei — absurdly below the tip (malformed)
        maxPriorityFeePerGas: 200n * gwei, // 200 gwei, > 50 gwei ZkSync ceiling
      })

      const quote = await getEvmFeeQuote({ keysignPayload: emptyPayload })

      // Raw split would be 1n - 200_000_000_000n (negative); floored to 0n.
      expect(quote.baseFeePerGas).toBe(0n)
      // Priority still clamped down to the 50 gwei ZkSync ceiling.
      expect(quote.maxPriorityFeePerGas).toBe(50n * gwei)
      // Rebuilt maxFeePerGas (base + clamped priority) is therefore non-negative.
      expect(quote.baseFeePerGas + quote.maxPriorityFeePerGas).toBeGreaterThanOrEqual(0n)
    })

    it('clamps an absurdly inflated ZkSync priority fee to the sanity ceiling (SDK2-01)', async () => {
      mocks.zksyncFeeClient.estimateFee.mockResolvedValue({
        gasLimit: 700_001n,
        maxFeePerGas: 6_000n * gwei,
        maxPriorityFeePerGas: 5_000n * gwei,
      })

      const quote = await getEvmFeeQuote({ keysignPayload: emptyPayload })

      // Zksync's 50 gwei L2 ceiling still catches an order-of-magnitude inflation.
      expect(quote.maxPriorityFeePerGas).toBe(50n * gwei)
      // baseFeePerGas is still derived from the raw (unclamped) split.
      expect(quote.baseFeePerGas).toBe(6_000n * gwei - 5_000n * gwei)
    })
  })

  describe('priority fee sanity', () => {
    it('passes a normal RPC-reported priority fee through unchanged (SDK2-01 legit-path guard)', async () => {
      // 80 gwei — a realistic heavy-congestion Ethereum L1 tip, well under the 500 gwei ceiling.
      mocks.getEvmMaxPriorityFeePerGas.mockResolvedValue(80n * gwei)

      const quote = await getEvmFeeQuote({ keysignPayload: transferPayload })

      expect(quote.maxPriorityFeePerGas).toBe(80n * gwei)
    })

    it('clamps an absurdly inflated RPC-reported priority fee to the sanity ceiling (SDK2-01)', async () => {
      // A compromised/anomalous RPC reporting 10,000 gwei — orders of magnitude above any
      // legitimate Ethereum L1 congestion tip.
      mocks.getEvmMaxPriorityFeePerGas.mockResolvedValue(10_000n * gwei)

      const quote = await getEvmFeeQuote({ keysignPayload: transferPayload })

      expect(quote.maxPriorityFeePerGas).toBe(500n * gwei)
    })
  })
})
