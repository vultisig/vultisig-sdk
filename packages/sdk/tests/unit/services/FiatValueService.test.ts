import { Chain } from '@core/chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// IMPORTANT: Mocks must be defined BEFORE imports
vi.mock('@core/chain/coin/price/getCoinPrices')
vi.mock('@core/chain/coin/price/evm/getErc20Prices')
vi.mock('@core/chain/coin/utils/getCoinValue')
vi.mock('@core/chain/coin/chainFeeCoin', () => ({
  chainFeeCoin: {
    Ethereum: {
      ticker: 'ETH',
      decimals: 18,
      priceProviderId: 'ethereum',
    },
    Bitcoin: {
      ticker: 'BTC',
      decimals: 8,
      priceProviderId: 'bitcoin',
    },
    Solana: {
      ticker: 'SOL',
      decimals: 9,
      priceProviderId: 'solana',
    },
    Polygon: {
      ticker: 'MATIC',
      decimals: 18,
      priceProviderId: 'matic-network',
    },
  },
}))

import { CacheService } from '../../../src/services/CacheService'
import { FiatValueService } from '../../../src/services/FiatValueService'
import type { Balance } from '../../../src/types'

describe('FiatValueService', () => {
  let service: FiatValueService
  let cache: CacheService
  let getCurrency: () => string
  let getTokens: () => Record<string, any[]>

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks()

    // Reset cache
    cache = new CacheService()

    // Mock currency getter
    getCurrency = vi.fn(() => 'usd')

    // Mock tokens getter
    getTokens = vi.fn(() => ({}))

    // Create service
    service = new FiatValueService(cache, getCurrency, getTokens)
  })

  describe('getPrice', () => {
    it('should fetch native token price', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000.5,
      })

      const price = await service.getPrice(Chain.Ethereum)

      expect(price).toBe(3000.5)
      expect(getCoinPrices).toHaveBeenCalledWith({
        ids: ['ethereum'],
        fiatCurrency: 'usd',
      })
    })

    it('should cache prices for 5 minutes', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      vi.mocked(getCoinPrices).mockResolvedValue({
        bitcoin: 50000,
      })

      // First call
      await service.getPrice(Chain.Bitcoin)

      // Second call (should use cache)
      await service.getPrice(Chain.Bitcoin)

      // Should only call API once
      expect(getCoinPrices).toHaveBeenCalledTimes(1)
    })

    it('should fetch token price for ERC-20 tokens', async () => {
      const { getErc20Prices } = await import(
        '@core/chain/coin/price/evm/getErc20Prices'
      )
      vi.mocked(getErc20Prices).mockResolvedValue({
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1.0, // USDC
      })

      const price = await service.getPrice(
        Chain.Ethereum,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      )

      expect(price).toBe(1.0)
      expect(getErc20Prices).toHaveBeenCalledWith({
        ids: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        chain: Chain.Ethereum,
        fiatCurrency: 'usd',
      })
    })

    it('should support different fiat currencies', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 2500,
      })

      const price = await service.getPrice(Chain.Ethereum, undefined, 'eur')

      expect(price).toBe(2500)
      expect(getCoinPrices).toHaveBeenCalledWith({
        ids: ['ethereum'],
        fiatCurrency: 'eur',
      })
    })

    it('should throw error if price not found', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      vi.mocked(getCoinPrices).mockResolvedValue({})

      await expect(service.getPrice(Chain.Ethereum)).rejects.toThrow(
        'Price not found for Ethereum'
      )
    })
  })

  describe('getPrices', () => {
    it('should fetch multiple prices in batch', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000,
        bitcoin: 50000,
        solana: 100,
      })

      const prices = await service.getPrices([
        Chain.Ethereum,
        Chain.Bitcoin,
        Chain.Solana,
      ])

      expect(prices).toEqual({
        [Chain.Ethereum]: 3000,
        [Chain.Bitcoin]: 50000,
        [Chain.Solana]: 100,
      })
      expect(getCoinPrices).toHaveBeenCalledTimes(1)
      expect(getCoinPrices).toHaveBeenCalledWith({
        ids: ['ethereum', 'bitcoin', 'solana'],
        fiatCurrency: 'usd',
      })
    })

    it('should use cached prices and only fetch uncached', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )

      // First call - caches ETH price
      vi.mocked(getCoinPrices).mockResolvedValueOnce({
        ethereum: 3000,
      })
      await service.getPrice(Chain.Ethereum)

      // Second call - should use cache for ETH, fetch BTC
      vi.mocked(getCoinPrices).mockResolvedValueOnce({
        bitcoin: 50000,
      })
      const prices = await service.getPrices([Chain.Ethereum, Chain.Bitcoin])

      expect(prices).toEqual({
        [Chain.Ethereum]: 3000,
        [Chain.Bitcoin]: 50000,
      })

      // getCoinPrices called twice total (once for ETH, once for BTC)
      expect(getCoinPrices).toHaveBeenCalledTimes(2)

      // Second call should only request Bitcoin
      expect(getCoinPrices).toHaveBeenLastCalledWith({
        ids: ['bitcoin'],
        fiatCurrency: 'usd',
      })
    })

    it('should cache individual prices from batch fetch', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000,
        bitcoin: 50000,
      })

      // Batch fetch
      await service.getPrices([Chain.Ethereum, Chain.Bitcoin])

      // Individual fetches should use cache
      await service.getPrice(Chain.Ethereum)
      await service.getPrice(Chain.Bitcoin)

      // Should only call API once (for batch fetch)
      expect(getCoinPrices).toHaveBeenCalledTimes(1)
    })
  })

  describe('getBalanceValue', () => {
    it('should calculate balance value', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      const { getCoinValue } = await import(
        '@core/chain/coin/utils/getCoinValue'
      )

      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000.5,
      })
      vi.mocked(getCoinValue).mockReturnValue(4500.75)

      const balance: Balance = {
        amount: '1500000000000000000', // 1.5 ETH in wei
        decimals: 18,
        symbol: 'ETH',
        chainId: Chain.Ethereum,
      }

      const value = await service.getBalanceValue(balance)

      expect(value).toBe(4500.75)
      expect(getCoinValue).toHaveBeenCalledWith({
        amount: BigInt('1500000000000000000'),
        decimals: 18,
        price: 3000.5,
      })
    })

    it('should calculate token balance value', async () => {
      const { getErc20Prices } = await import(
        '@core/chain/coin/price/evm/getErc20Prices'
      )
      const { getCoinValue } = await import(
        '@core/chain/coin/utils/getCoinValue'
      )

      const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

      vi.mocked(getErc20Prices).mockResolvedValue({
        [usdcAddress.toLowerCase()]: 1.0,
      })
      vi.mocked(getCoinValue).mockReturnValue(100.0)

      const balance: Balance = {
        amount: '100000000', // 100 USDC (6 decimals)
        decimals: 6,
        symbol: 'USDC',
        chainId: Chain.Ethereum,
        tokenId: usdcAddress,
      }

      const value = await service.getBalanceValue(balance)

      expect(value).toBe(100.0)
    })

    it('should support different fiat currencies', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      const { getCoinValue } = await import(
        '@core/chain/coin/utils/getCoinValue'
      )

      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 2500, // EUR price
      })
      vi.mocked(getCoinValue).mockReturnValue(2500)

      const balance: Balance = {
        amount: '1000000000000000000', // 1 ETH
        decimals: 18,
        symbol: 'ETH',
        chainId: Chain.Ethereum,
      }

      await service.getBalanceValue(balance, 'eur')

      expect(getCoinPrices).toHaveBeenCalledWith({
        ids: ['ethereum'],
        fiatCurrency: 'eur',
      })
    })
  })

  describe('getPortfolioValue', () => {
    it('should calculate total portfolio value from balance array', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      const { getCoinValue } = await import(
        '@core/chain/coin/utils/getCoinValue'
      )

      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000,
        bitcoin: 50000,
      })

      // Mock getCoinValue to return different values
      vi.mocked(getCoinValue)
        .mockReturnValueOnce(3000) // 1 ETH
        .mockReturnValueOnce(50000) // 1 BTC

      const balances: Balance[] = [
        {
          amount: '1000000000000000000',
          decimals: 18,
          symbol: 'ETH',
          chainId: Chain.Ethereum,
        },
        {
          amount: '100000000',
          decimals: 8,
          symbol: 'BTC',
          chainId: Chain.Bitcoin,
        },
      ]

      const total = await service.getPortfolioValue(balances)

      expect(total).toBe(53000) // 3000 + 50000
    })

    it('should calculate total portfolio value from balance record', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      const { getCoinValue } = await import(
        '@core/chain/coin/utils/getCoinValue'
      )

      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000,
      })
      vi.mocked(getCoinValue).mockReturnValue(3000)

      const balances: Record<string, Balance> = {
        eth: {
          amount: '1000000000000000000',
          decimals: 18,
          symbol: 'ETH',
          chainId: Chain.Ethereum,
        },
      }

      const total = await service.getPortfolioValue(balances)

      expect(total).toBe(3000)
    })

    it('should handle individual balance errors gracefully', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )
      const { getCoinValue } = await import(
        '@core/chain/coin/utils/getCoinValue'
      )

      // First balance succeeds
      vi.mocked(getCoinPrices).mockResolvedValueOnce({
        ethereum: 3000,
      })
      vi.mocked(getCoinValue).mockReturnValueOnce(3000)

      // Second balance fails
      vi.mocked(getCoinPrices).mockRejectedValueOnce(
        new Error('API rate limit')
      )

      const balances: Balance[] = [
        {
          amount: '1000000000000000000',
          decimals: 18,
          symbol: 'ETH',
          chainId: Chain.Ethereum,
        },
        {
          amount: '100000000',
          decimals: 8,
          symbol: 'BTC',
          chainId: Chain.Bitcoin,
        },
      ]

      // Should not throw, but return partial total
      const total = await service.getPortfolioValue(balances)
      expect(total).toBe(3000) // Only ETH value, BTC failed
    })

    it('should return zero for empty balances', async () => {
      const total = await service.getPortfolioValue([])
      expect(total).toBe(0)
    })
  })

  describe('clearCache', () => {
    it('should clear all cached prices', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )

      // Cache some prices
      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000,
      })
      await service.getPrice(Chain.Ethereum)

      // Clear cache
      service.clearCache()

      // Next call should fetch fresh
      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3500,
      })
      const price = await service.getPrice(Chain.Ethereum)

      expect(price).toBe(3500)
      expect(getCoinPrices).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling', () => {
    it('should throw error when token price not found', async () => {
      const { getErc20Prices } = await import(
        '@core/chain/coin/price/evm/getErc20Prices'
      )
      vi.mocked(getErc20Prices).mockResolvedValue({})

      await expect(
        service.getPrice(Chain.Ethereum, '0xInvalidToken')
      ).rejects.toThrow('Price not found for token')
    })

    it('should throw error for token pricing on non-EVM chains', async () => {
      // Bitcoin is not an EVM chain
      await expect(
        service.getPrice(Chain.Bitcoin, '0xSomeToken')
      ).rejects.toThrow('Token pricing not supported for Bitcoin')
    })
  })

  describe('currency override', () => {
    it('should use vault currency by default', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )

      getCurrency = vi.fn(() => 'eur')
      service = new FiatValueService(cache, getCurrency, getTokens)

      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 2500,
      })

      await service.getPrice(Chain.Ethereum)

      expect(getCoinPrices).toHaveBeenCalledWith({
        ids: ['ethereum'],
        fiatCurrency: 'eur',
      })
    })

    it('should allow currency override per call', async () => {
      const { getCoinPrices } = await import(
        '@core/chain/coin/price/getCoinPrices'
      )

      getCurrency = vi.fn(() => 'usd')
      service = new FiatValueService(cache, getCurrency, getTokens)

      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 2200,
      })

      await service.getPrice(Chain.Ethereum, undefined, 'gbp')

      expect(getCoinPrices).toHaveBeenCalledWith({
        ids: ['ethereum'],
        fiatCurrency: 'gbp',
      })
    })
  })
})
