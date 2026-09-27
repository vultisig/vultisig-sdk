import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueryCoingeickoPrices, mockGetLifiTokenPrices, mockGetUsdToFiatRate, mockGetEvmVaultTokenPrices } =
  vi.hoisted(() => ({
    mockQueryCoingeickoPrices: vi.fn(),
    mockGetLifiTokenPrices: vi.fn(),
    mockGetUsdToFiatRate: vi.fn(),
    mockGetEvmVaultTokenPrices: vi.fn(),
  }))

vi.mock('../queryCoingeickoPrices', () => ({
  queryCoingeickoPrices: mockQueryCoingeickoPrices,
}))

vi.mock('./getLifiTokenPrices', () => ({
  getLifiTokenPrices: mockGetLifiTokenPrices,
}))

vi.mock('./getEvmVaultTokenPrices', () => ({
  getEvmVaultTokenPrices: mockGetEvmVaultTokenPrices,
}))

vi.mock('../getUsdToFiatRate', () => ({
  getUsdToFiatRate: mockGetUsdToFiatRate,
}))

import {
  contractPriceBatchSize,
  contractPricesDeadlineMs,
  getErc20Prices,
  getErc20PricesSettled,
} from './getErc20Prices'

const lifi = (prices: Record<string, number> = {}, failedIds: string[] = []) => ({ prices, failedIds })

const usdcAddr = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const vthorAddr = '0x815c23eca83261b6ec689b60cc4a58b54bc24d8d'

describe('getErc20Prices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUsdToFiatRate.mockResolvedValue(1)
    mockGetEvmVaultTokenPrices.mockResolvedValue({})
  })

  it('lowercases response keys so checksum-cased contract addresses resolve', async () => {
    mockQueryCoingeickoPrices.mockResolvedValue({
      [usdcAddr]: 1,
    })

    const prices = await getErc20Prices({
      ids: [usdcAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices[usdcAddr.toLowerCase()]).toBe(1)
  })

  it('skips the LiFi fallback when CoinGecko covers every contract', async () => {
    mockQueryCoingeickoPrices.mockResolvedValue({
      [usdcAddr.toLowerCase()]: 1,
    })

    await getErc20Prices({
      ids: [usdcAddr],
      chain: EvmChain.Ethereum,
    })

    expect(mockGetLifiTokenPrices).not.toHaveBeenCalled()
  })

  it('prices contracts CoinGecko omits through the LiFi fallback', async () => {
    mockQueryCoingeickoPrices.mockResolvedValue({
      [usdcAddr.toLowerCase()]: 1,
    })
    mockGetLifiTokenPrices.mockResolvedValue(lifi({ [vthorAddr]: 0.29 }))

    const prices = await getErc20Prices({
      ids: [usdcAddr, vthorAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices).toEqual({
      [usdcAddr.toLowerCase()]: 1,
      [vthorAddr]: 0.29,
    })
    expect(mockGetLifiTokenPrices).toHaveBeenCalledWith({
      ids: [vthorAddr],
      chain: EvmChain.Ethereum,
    })
  })

  it('converts LiFi USD prices into the requested fiat currency', async () => {
    mockQueryCoingeickoPrices.mockResolvedValue({})
    mockGetLifiTokenPrices.mockResolvedValue(lifi({ [vthorAddr]: 0.29 }))
    mockGetUsdToFiatRate.mockResolvedValue(0.9)

    const prices = await getErc20Prices({
      ids: [vthorAddr],
      chain: EvmChain.Ethereum,
      fiatCurrency: 'eur',
    })

    expect(mockGetUsdToFiatRate).toHaveBeenCalledWith('eur')
    expect(prices[vthorAddr]).toBeCloseTo(0.261)
  })

  it('lets a NAV vault price win over market feeds and skip the LiFi fallback', async () => {
    mockQueryCoingeickoPrices.mockResolvedValue({
      [usdcAddr.toLowerCase()]: 1,
      [vthorAddr]: 0.3,
    })
    mockGetEvmVaultTokenPrices.mockResolvedValue({
      [vthorAddr]: 0.16,
    })

    const prices = await getErc20Prices({
      ids: [usdcAddr, vthorAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices[vthorAddr]).toBe(0.16)
    expect(mockGetLifiTokenPrices).not.toHaveBeenCalled()
  })

  it('falls through to LiFi for a vault whose NAV read fails', async () => {
    mockQueryCoingeickoPrices.mockResolvedValue({})
    mockGetEvmVaultTokenPrices.mockResolvedValue({})
    mockGetLifiTokenPrices.mockResolvedValue(lifi({ [vthorAddr]: 0.29 }))

    const prices = await getErc20Prices({
      ids: [vthorAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices[vthorAddr]).toBe(0.29)
  })

  it('keeps a later batch when an earlier contract-price batch fails', async () => {
    const filler = Array.from(
      { length: contractPriceBatchSize },
      (_, index) => `0x${(index + 1).toString(16).padStart(40, '0')}`
    )
    mockQueryCoingeickoPrices
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValueOnce({ [usdcAddr.toLowerCase()]: 1 })

    const prices = await getErc20Prices({
      ids: [...filler, usdcAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices[usdcAddr.toLowerCase()]).toBe(1)
    expect(mockQueryCoingeickoPrices).toHaveBeenCalledTimes(3)
    expect(mockGetLifiTokenPrices).not.toHaveBeenCalled()
  })

  it('throws when every contract-price batch fails', async () => {
    mockQueryCoingeickoPrices.mockRejectedValue(new Error('down'))

    await expect(
      getErc20Prices({
        ids: [usdcAddr],
        chain: EvmChain.Ethereum,
      })
    ).rejects.toThrow('down')
    expect(mockQueryCoingeickoPrices).toHaveBeenCalledTimes(2)
  })

  it('keeps CoinGecko prices when the LiFi fallback fails', async () => {
    mockQueryCoingeickoPrices.mockResolvedValue({
      [usdcAddr.toLowerCase()]: 1,
    })
    mockGetLifiTokenPrices.mockRejectedValue(new Error('lifi down'))

    const prices = await getErc20Prices({
      ids: [usdcAddr, vthorAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices).toEqual({
      [usdcAddr.toLowerCase()]: 1,
    })
  })

  it('reports a failed CoinGecko batch and does not ask LiFi about it', async () => {
    const filler = Array.from(
      { length: contractPriceBatchSize },
      (_, index) => `0x${(index + 1).toString(16).padStart(40, '0')}`
    )
    mockQueryCoingeickoPrices
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValueOnce({ [usdcAddr.toLowerCase()]: 1 })
    mockGetLifiTokenPrices.mockResolvedValue(lifi())

    const lookup = await getErc20PricesSettled({
      ids: [...filler, usdcAddr],
      chain: EvmChain.Ethereum,
    })

    expect(lookup.prices[usdcAddr.toLowerCase()]).toBe(1)
    expect(lookup.failedIds).toEqual(filler.map(id => id.toLowerCase()))
    expect(mockGetLifiTokenPrices).not.toHaveBeenCalled()
  })

  it('returns finished batches when a later batch hits the deadline', async () => {
    vi.useFakeTimers()
    try {
      const priced = Array.from(
        { length: contractPriceBatchSize },
        (_, index) => `0x${(index + 1).toString(16).padStart(40, '0')}`
      )
      const stalled = Array.from(
        { length: contractPriceBatchSize },
        (_, index) => `0x${(index + 1 + contractPriceBatchSize).toString(16).padStart(40, '0')}`
      )
      let calls = 0
      let secondStarted: () => void = () => undefined
      const secondBatchStarted = new Promise<void>(resolve => {
        secondStarted = resolve
      })
      mockQueryCoingeickoPrices.mockImplementation((input: { signal: AbortSignal }) => {
        calls += 1
        if (calls === 1) {
          return Promise.resolve(Object.fromEntries(priced.map(id => [id, 1])))
        }
        secondStarted()
        return new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })

      const pending = getErc20PricesSettled({
        ids: [...priced, ...stalled],
        chain: EvmChain.Ethereum,
      })
      await secondBatchStarted
      await vi.advanceTimersByTimeAsync(contractPricesDeadlineMs)
      const lookup = await pending

      expect(lookup.prices[priced[0]]).toBe(1)
      expect(mockQueryCoingeickoPrices).toHaveBeenCalledTimes(2)
      expect(lookup.failedIds).toEqual(stalled)
      expect(mockGetLifiTokenPrices).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects at the deadline when the first batch never returns', async () => {
    vi.useFakeTimers()
    try {
      let started: () => void = () => undefined
      const requestStarted = new Promise<void>(resolve => {
        started = resolve
      })
      mockQueryCoingeickoPrices.mockImplementation((input: { signal: AbortSignal }) => {
        started()
        return new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })

      const pending = getErc20Prices({
        ids: [usdcAddr],
        chain: EvmChain.Ethereum,
      })
      const assertion = expect(pending).rejects.toThrow('aborted')
      await requestStarted
      await vi.advanceTimersByTimeAsync(contractPricesDeadlineMs)
      await assertion
      expect(mockGetLifiTokenPrices).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
