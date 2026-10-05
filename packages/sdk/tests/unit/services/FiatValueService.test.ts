import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// IMPORTANT: Mocks must be defined BEFORE imports
vi.mock('@vultisig/core-chain/coin/price/getCoinPrices')
vi.mock('@vultisig/core-chain/coin/price/evm/getErc20Prices', () => ({
  getErc20Prices: vi.fn(),
}))
vi.mock('@vultisig/core-chain/coin/price/resolveTokenPriceId', () => ({
  resolveTokenPriceId: vi.fn(),
}))
vi.mock('@vultisig/core-chain/chains/cosmos/cosmosFeeCoinDenom', () => ({
  cosmosFeeCoinDenom: { TerraClassic: 'uluna' },
}))
vi.mock('@vultisig/core-chain/coin/utils/getCoinValue')
vi.mock('@vultisig/core-chain/coin/chainFeeCoin', () => ({
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
    TerraClassic: {
      ticker: 'LUNC',
      decimals: 6,
      priceProviderId: 'terra-luna',
    },
  },
}))

import { CacheService } from '../../../src/services/CacheService'
import { FiatValueService } from '../../../src/services/FiatValueService'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import type { Balance } from '../../../src/types'

describe('FiatValueService', () => {
  let service: FiatValueService
  let cache: CacheService
  let getCurrency: any
  let getTokens: () => Record<string, any[]>
  let getChains: () => Chain[]
  let getBalance: (chain: Chain, tokenId?: string) => Promise<Balance>

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks()

    // Reset cache
    cache = new CacheService(new MemoryStorage())

    // Mock currency getter
    getCurrency = vi.fn(() => 'usd')

    // Mock tokens getter
    getTokens = vi.fn(() => ({}))

    // Mock chains getter
    getChains = vi.fn(() => [Chain.Ethereum, Chain.Bitcoin])

    // Mock balance getter
    getBalance = vi.fn(async () => ({
      amount: '1000000000000000000',
      formattedAmount: '1',
      decimals: 18,
      symbol: 'ETH',
      chainId: Chain.Ethereum,
    }))

    // Create service
    service = new FiatValueService(cache, getCurrency, getTokens, getChains, getBalance)
  })

  describe('getPrice', () => {
    it('should fetch native token price', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
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
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
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
      const { getErc20Prices } = await import('@vultisig/core-chain/coin/price/evm/getErc20Prices')
      vi.mocked(getErc20Prices).mockResolvedValue({
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1.0, // USDC
      })

      const price = await service.getPrice(Chain.Ethereum, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

      expect(price).toBe(1.0)
      expect(getErc20Prices).toHaveBeenCalledWith({
        ids: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
        chain: Chain.Ethereum,
        fiatCurrency: 'usd',
      })
    })

    for (const chain of [Chain.BSC, Chain.Zksync, Chain.Hyperliquid]) {
      it(`should route ${chain} tokens through the EVM price API`, async () => {
        const { getErc20Prices } = await import('@vultisig/core-chain/coin/price/evm/getErc20Prices')
        const tokenAddress = '0xA0b86991c6218b36c1d19d4a2e9Eb0cE3606eB48'
        vi.mocked(getErc20Prices).mockResolvedValue({
          [tokenAddress.toLowerCase()]: 1,
        })

        await expect(service.getPrice(chain, tokenAddress)).resolves.toBe(1)
        expect(getErc20Prices).toHaveBeenCalledWith({
          ids: [tokenAddress],
          chain,
          fiatCurrency: 'usd',
        })
      })
    }

    it('should support different fiat currencies', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
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
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      vi.mocked(getCoinPrices).mockResolvedValue({})

      await expect(service.getPrice(Chain.Ethereum)).rejects.toThrow('Price not found for Ethereum')
    })
  })

  describe('getPrices', () => {
    it('should fetch multiple prices in batch', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000,
        bitcoin: 50000,
        solana: 100,
      })

      const prices = await service.getPrices([Chain.Ethereum, Chain.Bitcoin, Chain.Solana])

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
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')

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
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
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

  describe('getValues', () => {
    it('batches all token prices for a chain into a single getErc20Prices call', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { getErc20Prices } = await import('@vultisig/core-chain/coin/price/evm/getErc20Prices')
      const { getCoinValue } = await import('@vultisig/core-chain/coin/utils/getCoinValue')

      const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      const dai = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

      getTokens = vi.fn(() => ({
        [Chain.Ethereum]: [
          { id: usdc, symbol: 'USDC', name: 'USD Coin', decimals: 6, chainId: Chain.Ethereum, contractAddress: usdc },
          { id: dai, symbol: 'DAI', name: 'Dai', decimals: 18, chainId: Chain.Ethereum, contractAddress: dai },
        ],
      }))
      getBalance = vi.fn(async (_chain: Chain, tokenId?: string) => ({
        amount: '1000000',
        formattedAmount: '1',
        decimals: 6,
        symbol: tokenId ? 'TOKEN' : 'ETH',
        chainId: Chain.Ethereum,
        tokenId,
      }))
      service = new FiatValueService(cache, getCurrency, getTokens, getChains, getBalance)

      vi.mocked(getCoinPrices).mockResolvedValue({ ethereum: 3000 })
      vi.mocked(getErc20Prices).mockResolvedValue({
        [usdc.toLowerCase()]: 1.0,
        [dai.toLowerCase()]: 1.0,
      })
      vi.mocked(getCoinValue).mockReturnValue(1)

      const values = await service.getValues(Chain.Ethereum)

      // ONE batched price call for both tokens, not one per token.
      expect(getErc20Prices).toHaveBeenCalledTimes(1)
      expect(getErc20Prices).toHaveBeenCalledWith({
        ids: [usdc, dai],
        chain: Chain.Ethereum,
        fiatCurrency: 'usd',
      })

      expect(values.native).toBeDefined()
      expect(values[usdc]).toBeDefined()
      expect(values[dai]).toBeDefined()
    })

    it('rejects a non-EVM token with no price source', async () => {
      const { resolveTokenPriceId } = await import('@vultisig/core-chain/coin/price/resolveTokenPriceId')
      const tokenId = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'
      vi.mocked(resolveTokenPriceId).mockReturnValue(undefined)
      getBalance = vi.fn(async () => ({
        amount: '210330',
        formattedAmount: '0.00021033',
        decimals: 9,
        symbol: 'ETH',
        chainId: Chain.Solana,
        tokenId,
      }))
      service = new FiatValueService(cache, getCurrency, getTokens, getChains, getBalance)

      await expect(service.getValue(Chain.Solana, tokenId)).rejects.toThrow(
        `No price source for token ${tokenId} on ${Chain.Solana}`
      )
    })

    it('reports an unpriced token from getValuesDetailed and omits it from values', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { resolveTokenPriceId } = await import('@vultisig/core-chain/coin/price/resolveTokenPriceId')
      const { getCoinValue } = await import('@vultisig/core-chain/coin/utils/getCoinValue')
      const tokenId = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'
      getTokens = vi.fn(() => ({
        [Chain.Solana]: [
          {
            id: tokenId,
            symbol: 'ETH',
            name: 'Wrapped Ether',
            decimals: 8,
            chainId: Chain.Solana,
            contractAddress: tokenId,
          },
        ],
      }))
      getBalance = vi.fn(async (_chain: Chain, requestedTokenId?: string) => ({
        amount: requestedTokenId ? '21033' : '1000000000',
        formattedAmount: requestedTokenId ? '0.00021033' : '1',
        decimals: requestedTokenId ? 8 : 9,
        symbol: requestedTokenId ? 'ETH' : 'SOL',
        chainId: Chain.Solana,
        tokenId: requestedTokenId,
      }))
      vi.mocked(resolveTokenPriceId).mockReturnValue(undefined)
      vi.mocked(getCoinPrices).mockResolvedValue({ solana: 150 })
      vi.mocked(getCoinValue).mockReturnValue(150)
      service = new FiatValueService(cache, getCurrency, getTokens, getChains, getBalance)

      const result = await service.getValuesDetailed(Chain.Solana)

      expect(result.values.native).toBeDefined()
      expect(result.values[tokenId]).toBeUndefined()
      expect(result.failures).toEqual([
        {
          tokenId,
          error: `No price source for token ${tokenId} on ${Chain.Solana}`,
        },
      ])
    })

    it('reports an EVM token price miss from getValuesDetailed', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { getErc20Prices } = await import('@vultisig/core-chain/coin/price/evm/getErc20Prices')
      const { getCoinValue } = await import('@vultisig/core-chain/coin/utils/getCoinValue')
      const tokenId = '0x0000000000000000000000000000000000000001'
      getTokens = vi.fn(() => ({
        [Chain.Ethereum]: [
          {
            id: tokenId,
            symbol: 'MISS',
            name: 'Missing',
            decimals: 18,
            chainId: Chain.Ethereum,
            contractAddress: tokenId,
          },
        ],
      }))
      getBalance = vi.fn(async (_chain: Chain, requestedTokenId?: string) => ({
        amount: '1000000000000000000',
        formattedAmount: '1',
        decimals: 18,
        symbol: requestedTokenId ? 'MISS' : 'ETH',
        chainId: Chain.Ethereum,
        tokenId: requestedTokenId,
      }))
      vi.mocked(getCoinPrices).mockResolvedValue({ ethereum: 3000 })
      vi.mocked(getErc20Prices).mockResolvedValue({})
      vi.mocked(getCoinValue).mockReturnValue(3000)
      service = new FiatValueService(cache, getCurrency, getTokens, getChains, getBalance)

      const result = await service.getValuesDetailed(Chain.Ethereum)

      expect(result.values[tokenId]).toBeUndefined()
      expect(result.failures).toEqual([
        {
          tokenId,
          error: `Price not found for token ${tokenId} on ${Chain.Ethereum}`,
        },
      ])
    })

    it('returns a priced token from getValuesDetailed', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { getErc20Prices } = await import('@vultisig/core-chain/coin/price/evm/getErc20Prices')
      const { getCoinValue } = await import('@vultisig/core-chain/coin/utils/getCoinValue')
      const tokenId = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      getTokens = vi.fn(() => ({
        [Chain.Ethereum]: [
          {
            id: tokenId,
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            chainId: Chain.Ethereum,
            contractAddress: tokenId,
          },
        ],
      }))
      getBalance = vi.fn(async (_chain: Chain, requestedTokenId?: string) => ({
        amount: requestedTokenId ? '6250000' : '1000000000000000000',
        formattedAmount: requestedTokenId ? '6.25' : '1',
        decimals: requestedTokenId ? 6 : 18,
        symbol: requestedTokenId ? 'USDC' : 'ETH',
        chainId: Chain.Ethereum,
        tokenId: requestedTokenId,
      }))
      vi.mocked(getCoinPrices).mockResolvedValue({ ethereum: 3000 })
      vi.mocked(getErc20Prices).mockResolvedValue({
        [tokenId.toLowerCase()]: 1,
      })
      vi.mocked(getCoinValue).mockImplementation(({ decimals }) => (decimals === 6 ? 6.25 : 3000))
      service = new FiatValueService(cache, getCurrency, getTokens, getChains, getBalance)

      const result = await service.getValuesDetailed(Chain.Ethereum)

      expect(result.values[tokenId]?.amount).toBe('6.25')
      expect(result.failures).toEqual([])
    })
  })

  describe('getBalanceValue', () => {
    it('should calculate balance value', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { getCoinValue } = await import('@vultisig/core-chain/coin/utils/getCoinValue')

      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000.5,
      })
      vi.mocked(getCoinValue).mockReturnValue(4500.75)

      const balance: Balance = {
        amount: '1500000000000000000', // 1.5 ETH in wei
        formattedAmount: '1.5',
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
      const { getErc20Prices } = await import('@vultisig/core-chain/coin/price/evm/getErc20Prices')
      const { getCoinValue } = await import('@vultisig/core-chain/coin/utils/getCoinValue')

      const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

      vi.mocked(getErc20Prices).mockResolvedValue({
        [usdcAddress.toLowerCase()]: 1.0,
      })
      vi.mocked(getCoinValue).mockReturnValue(100.0)

      const balance: Balance = {
        amount: '100000000', // 100 USDC (6 decimals)
        formattedAmount: '100',
        decimals: 6,
        symbol: 'USDC',
        chainId: Chain.Ethereum,
        tokenId: usdcAddress,
      }

      const value = await service.getBalanceValue(balance)

      expect(value).toBe(100.0)
    })

    it('should support different fiat currencies', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { getCoinValue } = await import('@vultisig/core-chain/coin/utils/getCoinValue')

      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 2500, // EUR price
      })
      vi.mocked(getCoinValue).mockReturnValue(2500)

      const balance: Balance = {
        amount: '1000000000000000000', // 1 ETH
        formattedAmount: '1',
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
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { getCoinValue } = await import('@vultisig/core-chain/coin/utils/getCoinValue')

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
          formattedAmount: '1',
          decimals: 18,
          symbol: 'ETH',
          chainId: Chain.Ethereum,
        },
        {
          amount: '100000000',
          formattedAmount: '1',
          decimals: 8,
          symbol: 'BTC',
          chainId: Chain.Bitcoin,
        },
      ]

      const total = await service.getPortfolioValue(balances)

      expect(total).toBe(53000) // 3000 + 50000
    })

    it('should calculate total portfolio value from balance record', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { getCoinValue } = await import('@vultisig/core-chain/coin/utils/getCoinValue')

      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000,
      })
      vi.mocked(getCoinValue).mockReturnValue(3000)

      const balances: Record<string, Balance> = {
        eth: {
          amount: '1000000000000000000',
          formattedAmount: '1',
          decimals: 18,
          symbol: 'ETH',
          chainId: Chain.Ethereum,
        },
      }

      const total = await service.getPortfolioValue(balances)

      expect(total).toBe(3000)
    })

    it('should handle individual balance errors gracefully', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { getCoinValue } = await import('@vultisig/core-chain/coin/utils/getCoinValue')

      // First balance succeeds
      vi.mocked(getCoinPrices).mockResolvedValueOnce({
        ethereum: 3000,
      })
      vi.mocked(getCoinValue).mockReturnValueOnce(3000)

      // Second balance fails
      vi.mocked(getCoinPrices).mockRejectedValueOnce(new Error('API rate limit'))

      const balances: Balance[] = [
        {
          amount: '1000000000000000000',
          formattedAmount: '1',
          decimals: 18,
          symbol: 'ETH',
          chainId: Chain.Ethereum,
        },
        {
          amount: '100000000',
          formattedAmount: '1',
          decimals: 8,
          symbol: 'BTC',
          chainId: Chain.Bitcoin,
        },
      ]

      // Should not throw, but return partial total
      const total = await service.getPortfolioValue(balances)
      expect(total).toBe(3000) // Only ETH value, BTC failed
    })

    it('reports an unpriced balance while excluding it from the detailed total', async () => {
      vi.spyOn(service, 'getBalanceValue').mockImplementation(async balance => {
        if (balance.symbol === 'MISS') throw new Error('No price source')
        return 3000
      })
      const tokenId = 'unpriced-token'
      const balances: Balance[] = [
        {
          amount: '1000000000000000000',
          formattedAmount: '1',
          decimals: 18,
          symbol: 'ETH',
          chainId: Chain.Ethereum,
        },
        {
          amount: '1',
          formattedAmount: '1',
          decimals: 0,
          symbol: 'MISS',
          chainId: Chain.Solana,
          tokenId,
        },
      ]

      await expect(service.getPortfolioValue(balances)).resolves.toBe(3000)
      await expect(service.getPortfolioValueDetailed(balances)).resolves.toEqual({
        total: 3000,
        failures: [{ chain: Chain.Solana, tokenId, error: 'No price source' }],
      })
    })

    it('should return zero for empty balances', async () => {
      const total = await service.getPortfolioValue([])
      expect(total).toBe(0)
    })
  })

  describe('getTotalValueDetailed', () => {
    it('sums priced assets and reports an unpriced token', async () => {
      const tokenId = 'unpriced-token'
      getChains = vi.fn(() => [Chain.Ethereum, Chain.Solana])
      service = new FiatValueService(cache, getCurrency, getTokens, getChains, getBalance)
      vi.spyOn(service, 'getValuesDetailed').mockImplementation(async chain =>
        chain === Chain.Ethereum
          ? {
              values: {
                native: {
                  amount: '3000.00',
                  currency: 'usd',
                  lastUpdated: 1,
                },
              },
              failures: [],
            }
          : {
              values: {
                native: { amount: '150.00', currency: 'usd', lastUpdated: 1 },
              },
              failures: [{ tokenId, error: 'No price source' }],
            }
      )

      await expect(service.getTotalValueDetailed('usd')).resolves.toEqual({
        total: '3150.00',
        failures: [{ chain: Chain.Solana, tokenId, error: 'No price source' }],
      })
      await expect(service.getTotalValue('usd')).resolves.toMatchObject({
        amount: '3150.00',
        currency: 'usd',
      })
    })
  })

  describe('clearPrices', () => {
    it('should clear all cached prices', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')

      // Cache some prices
      vi.mocked(getCoinPrices).mockResolvedValue({
        ethereum: 3000,
      })
      await service.getPrice(Chain.Ethereum)

      // Clear cache
      await service.clearPrices()

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
      const { getErc20Prices } = await import('@vultisig/core-chain/coin/price/evm/getErc20Prices')
      vi.mocked(getErc20Prices).mockResolvedValue({})

      await expect(service.getPrice(Chain.Ethereum, '0xInvalidToken')).rejects.toThrow('Price not found for token')
    })

    it('should fetch known non-EVM token prices through the canonical registry id', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { resolveTokenPriceId } = await import('@vultisig/core-chain/coin/price/resolveTokenPriceId')
      const solanaUsdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      vi.mocked(resolveTokenPriceId).mockReturnValue('usd-coin')
      vi.mocked(getCoinPrices).mockResolvedValue({ 'usd-coin': 1 })

      const price = await service.getPrice(Chain.Solana, solanaUsdc)

      expect(price).toBe(1)
      expect(getCoinPrices).toHaveBeenCalledWith({ ids: ['usd-coin'], fiatCurrency: 'usd' })
    })

    it('should price a Cosmos native fee denom passed as a token identifier', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
      const { resolveTokenPriceId } = await import('@vultisig/core-chain/coin/price/resolveTokenPriceId')
      vi.mocked(resolveTokenPriceId).mockReturnValue('terra-luna')
      vi.mocked(getCoinPrices).mockResolvedValue({ 'terra-luna': 0.000062 })

      await expect(service.getPrice(Chain.TerraClassic, ' uluna ')).resolves.toBe(0.000062)
      expect(getCoinPrices).toHaveBeenCalledWith({ ids: ['terra-luna'], fiatCurrency: 'usd' })
    })

    it('should reject unknown non-EVM token identifiers', async () => {
      const { resolveTokenPriceId } = await import('@vultisig/core-chain/coin/price/resolveTokenPriceId')
      vi.mocked(resolveTokenPriceId).mockReturnValue(undefined)
      await expect(service.getPrice(Chain.Bitcoin, 'not-a-known-token')).rejects.toThrow(
        'No price source for token not-a-known-token on Bitcoin'
      )
    })
  })

  describe('currency override', () => {
    it('should use vault currency by default', async () => {
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')

      getCurrency = vi.fn(() => 'eur')
      service = new FiatValueService(cache, getCurrency, getTokens, getChains, getBalance)

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
      const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')

      getCurrency = vi.fn(() => 'usd')
      service = new FiatValueService(cache, getCurrency, getTokens, getChains, getBalance)

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
