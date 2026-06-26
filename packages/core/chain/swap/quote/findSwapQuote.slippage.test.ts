import { Chain } from '@vultisig/core-chain/Chain'
import { getCowSwapQuote } from '@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { getOneInchSwapQuote } from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SwapErrorCode } from '../SwapError'
import { findSwapQuote } from './findSwapQuote'

vi.mock('@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote', () => ({
  getCowSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/general/kyber/api/quote', () => ({
  getKyberSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote', () => ({
  getOneInchSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote', () => ({
  getLifiSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote', () => ({
  getSwapKitQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({
  getNativeSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: vi.fn().mockResolvedValue(null),
}))

const erc20A = {
  chain: Chain.Ethereum,
  address: '0xsender',
  id: '0xsrc',
  decimals: 18,
  ticker: 'SRC',
}
const erc20B = {
  chain: Chain.Ethereum,
  address: '0xsender',
  id: '0xdst',
  decimals: 6,
  ticker: 'DST',
}

beforeEach(() => {
  vi.clearAllMocks()
  // All providers reject — we only assert the slippage args they were called with.
  vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('x'))
  vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('x'))
  vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('x'))
  vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('x'))
  vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('x'))
  vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('x'))
})

describe('findSwapQuote slippage tolerance', () => {
  it('converts the percent tolerance to each aggregator unit', async () => {
    await expect(
      findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n, slippageTolerance: 1 })
    ).rejects.toBeDefined()

    // 1inch wants percent
    expect(getOneInchSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ slippage: 1 }))
    // KyberSwap wants basis points
    expect(getKyberSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ slippageTolerance: 100 }))
    // LiFi wants a fraction
    expect(getLifiSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ slippage: 0.01 }))
    // SwapKit wants percent
    expect(getSwapKitQuote).toHaveBeenCalledWith(expect.objectContaining({ slippage: 1 }))
    // Native THOR/Maya quote APIs want basis points
    expect(getNativeSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ slippageToleranceBps: 100 }))
  })

  it('leaves each provider on its default when no tolerance is given', async () => {
    await expect(findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n })).rejects.toBeDefined()

    expect(getOneInchSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ slippage: undefined }))
    expect(getKyberSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ slippageTolerance: undefined }))
    expect(getLifiSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ slippage: undefined }))
    expect(getSwapKitQuote).toHaveBeenCalledWith(expect.objectContaining({ slippage: undefined }))
    expect(getNativeSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ slippageToleranceBps: undefined }))
  })

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid slippage %p before calling any provider', async invalid => {
    await expect(
      findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n, slippageTolerance: invalid })
    ).rejects.toThrow(/slippageTolerance/)

    expect(getOneInchSwapQuote).not.toHaveBeenCalled()
    expect(getKyberSwapQuote).not.toHaveBeenCalled()
    expect(getLifiSwapQuote).not.toHaveBeenCalled()
  })

  it.each([51, 100, 200])(
    'rejects slippage above the 50% ceiling (%p) before calling any provider',
    async oversized => {
      await expect(
        findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n, slippageTolerance: oversized })
      ).rejects.toMatchObject({
        code: SwapErrorCode.InvalidConfig,
        message: expect.stringContaining('slippageTolerance'),
      })

      expect(getOneInchSwapQuote).not.toHaveBeenCalled()
      expect(getKyberSwapQuote).not.toHaveBeenCalled()
      expect(getLifiSwapQuote).not.toHaveBeenCalled()
      expect(getSwapKitQuote).not.toHaveBeenCalled()
    }
  )

  it('accepts slippage exactly at the 50% ceiling', async () => {
    // Expect all providers called (they all reject in beforeEach, so the quote itself fails — but slippage validation passes).
    await expect(
      findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n, slippageTolerance: 50 })
    ).rejects.toBeDefined()

    expect(getOneInchSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ slippage: 50 }))
  })
})
