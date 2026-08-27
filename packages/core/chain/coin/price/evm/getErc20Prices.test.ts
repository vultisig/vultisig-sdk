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

import { getErc20Prices } from './getErc20Prices'

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
    mockGetLifiTokenPrices.mockResolvedValue({
      [vthorAddr]: 0.29,
    })

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
    mockGetLifiTokenPrices.mockResolvedValue({
      [vthorAddr]: 0.29,
    })
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
    mockGetLifiTokenPrices.mockResolvedValue({
      [vthorAddr]: 0.29,
    })

    const prices = await getErc20Prices({
      ids: [vthorAddr],
      chain: EvmChain.Ethereum,
    })

    expect(prices[vthorAddr]).toBe(0.29)
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
})
