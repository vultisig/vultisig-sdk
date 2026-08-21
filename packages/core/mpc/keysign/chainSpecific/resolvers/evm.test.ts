/**
 * Tests for getEvmChainSpecific — the orchestration layer around the EVM
 * fee/gas/nonce computation (nonce sourcing, calldata selection for gas-limit
 * derivation, and final maxFeePerGas/priorityFee/gasLimit assembly).
 *
 * getEvmFeeQuote itself (legacy vs EIP-1559 branching, RPC-tip clamping) is
 * already covered by ./fee/resolvers/evm/getEvmFeeQuote.test.ts — this file
 * pins what getEvmChainSpecific does on top of that: pending/latest nonce
 * fallback, swap-vs-memo calldata selection feeding deriveEvmGasLimit, and
 * the EthereumSpecific schema field assembly (nonce/maxFeePerGasWei/
 * priorityFee/gasLimit as strings).
 */
import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const client = {
    getTransactionCount: vi.fn(),
  }

  return {
    client,
    getEvmClient: vi.fn(),
    deriveEvmGasLimit: vi.fn(),
    getEvmFeeQuote: vi.fn(),
    getKeysignSwapPayload: vi.fn(),
    getKeysignCoin: vi.fn(),
  }
})

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: mocks.getEvmClient,
}))

vi.mock('@vultisig/core-chain/tx/fee/evm/evmGasLimit', () => ({
  deriveEvmGasLimit: mocks.deriveEvmGasLimit,
}))

vi.mock('@vultisig/core-mpc/keysign/fee/resolvers/evm/getEvmFeeQuote', () => ({
  getEvmFeeQuote: mocks.getEvmFeeQuote,
}))

vi.mock('../../swap/getKeysignSwapPayload', () => ({
  getKeysignSwapPayload: mocks.getKeysignSwapPayload,
}))

vi.mock('../../utils/getKeysignCoin', () => ({
  getKeysignCoin: mocks.getKeysignCoin,
}))

import { getEvmChainSpecific } from './evm'

const address = '0x1111111111111111111111111111111111111111'
const router = '0x2222222222222222222222222222222222222222'

const makeCoin = (chain: EvmChain = EvmChain.Ethereum) => ({
  chain,
  address,
})

const makePayload = (overrides: Record<string, unknown> = {}) => ({
  memo: '',
  ...overrides,
})

describe('getEvmChainSpecific', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEvmClient.mockReturnValue(mocks.client)
    mocks.getKeysignCoin.mockReturnValue(makeCoin())
    mocks.getKeysignSwapPayload.mockReturnValue(undefined)
    mocks.deriveEvmGasLimit.mockReturnValue(600_000n)
    mocks.getEvmFeeQuote.mockResolvedValue({
      gasLimit: 700_000n,
      baseFeePerGas: 150n,
      maxPriorityFeePerGas: 2_000_000_000n,
    })
    mocks.client.getTransactionCount.mockResolvedValue(5)
  })

  describe('nonce sourcing', () => {
    it('uses the pending block tag when the RPC supports it', async () => {
      mocks.client.getTransactionCount.mockResolvedValue(7)

      const result = await getEvmChainSpecific({
        keysignPayload: makePayload() as never,
        walletCore: {} as never,
      })

      expect(mocks.client.getTransactionCount).toHaveBeenCalledWith({
        address,
        blockTag: 'pending',
      })
      expect(mocks.client.getTransactionCount).toHaveBeenCalledTimes(1)
      expect(result.nonce).toBe(7n)
    })

    it('falls back to the latest block tag when pending is rejected (unsupported alt-EVM)', async () => {
      mocks.client.getTransactionCount
        .mockRejectedValueOnce(new Error('pending block tag not supported'))
        .mockResolvedValueOnce(9)

      const result = await getEvmChainSpecific({
        keysignPayload: makePayload() as never,
        walletCore: {} as never,
      })

      expect(mocks.client.getTransactionCount).toHaveBeenNthCalledWith(1, {
        address,
        blockTag: 'pending',
      })
      expect(mocks.client.getTransactionCount).toHaveBeenNthCalledWith(2, {
        address,
        blockTag: 'latest',
      })
      expect(result.nonce).toBe(9n)
    })
  })

  describe('calldata selection for gas-limit derivation', () => {
    it('uses the general swap quote tx data when present', async () => {
      mocks.getKeysignSwapPayload.mockReturnValue({
        general: { quote: { tx: { data: '0xswapdata' } } },
      })

      await getEvmChainSpecific({
        keysignPayload: makePayload({ memo: '0xmemo' }) as never,
        walletCore: {} as never,
      })

      expect(mocks.deriveEvmGasLimit).toHaveBeenCalledWith({
        coin: makeCoin(),
        data: '0xswapdata',
      })
    })

    it('falls back to memo when the general swap quote has no tx data', async () => {
      mocks.getKeysignSwapPayload.mockReturnValue({
        general: { quote: { tx: {} } },
      })

      await getEvmChainSpecific({
        keysignPayload: makePayload({ memo: '0xmemo' }) as never,
        walletCore: {} as never,
      })

      expect(mocks.deriveEvmGasLimit).toHaveBeenCalledWith({
        coin: makeCoin(),
        data: '0xmemo',
      })
    })

    it('falls back to memo for a native swap payload (no general.quote)', async () => {
      mocks.getKeysignSwapPayload.mockReturnValue({
        native: { chain: 'THORChain' },
      })

      await getEvmChainSpecific({
        keysignPayload: makePayload({ memo: '0xmemo' }) as never,
        walletCore: {} as never,
      })

      expect(mocks.deriveEvmGasLimit).toHaveBeenCalledWith({
        coin: makeCoin(),
        data: '0xmemo',
      })
    })

    it('falls back to memo when there is no swap payload at all', async () => {
      mocks.getKeysignSwapPayload.mockReturnValue(undefined)

      await getEvmChainSpecific({
        keysignPayload: makePayload({ memo: '0xmemo' }) as never,
        walletCore: {} as never,
      })

      expect(mocks.deriveEvmGasLimit).toHaveBeenCalledWith({
        coin: makeCoin(),
        data: '0xmemo',
      })
    })
  })

  describe('fee quote wiring', () => {
    it('passes the derived minimum gas limit and pass-through args into getEvmFeeQuote', async () => {
      mocks.deriveEvmGasLimit.mockReturnValue(123_456n)
      const keysignPayload = makePayload({ memo: '0xmemo' })
      const feeSettings = { gasLimit: 999n, maxPriorityFeePerGas: 1n }

      await getEvmChainSpecific({
        keysignPayload: keysignPayload as never,
        walletCore: {} as never,
        feeSettings: feeSettings as never,
        thirdPartyGasLimitEstimation: 111n,
      })

      expect(mocks.getEvmFeeQuote).toHaveBeenCalledWith({
        keysignPayload,
        feeSettings,
        thirdPartyGasLimitEstimation: 111n,
        minimumGasLimit: 123_456n,
      })
    })
  })

  describe('result assembly', () => {
    it('sums baseFeePerGas and maxPriorityFeePerGas into maxFeePerGasWei, and stringifies bigint fields', async () => {
      mocks.getEvmFeeQuote.mockResolvedValue({
        gasLimit: 700_000n,
        baseFeePerGas: 150n,
        maxPriorityFeePerGas: 2_000_000_000n,
      })
      mocks.client.getTransactionCount.mockResolvedValue(3)

      const result = await getEvmChainSpecific({
        keysignPayload: makePayload() as never,
        walletCore: {} as never,
      })

      expect(result.nonce).toBe(3n)
      expect(result.gasLimit).toBe('700000')
      expect(result.priorityFee).toBe('2000000000')
      expect(result.maxFeePerGasWei).toBe((150n + 2_000_000_000n).toString())
    })

    it('handles a zero-value fee quote (RPC returning zero baseFee/priority) without dropping the sum', async () => {
      mocks.getEvmFeeQuote.mockResolvedValue({
        gasLimit: 21_000n,
        baseFeePerGas: 0n,
        maxPriorityFeePerGas: 0n,
      })

      const result = await getEvmChainSpecific({
        keysignPayload: makePayload() as never,
        walletCore: {} as never,
      })

      expect(result.maxFeePerGasWei).toBe('0')
      expect(result.priorityFee).toBe('0')
      expect(result.gasLimit).toBe('21000')
    })
  })
})
