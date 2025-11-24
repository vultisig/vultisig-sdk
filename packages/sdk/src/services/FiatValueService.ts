import type { Chain } from '@core/chain/Chain'
import type { EvmChain } from '@core/chain/Chain'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { getErc20Prices } from '@core/chain/coin/price/evm/getErc20Prices'
import { getCoinPrices } from '@core/chain/coin/price/getCoinPrices'
import { getCoinValue } from '@core/chain/coin/utils/getCoinValue'
import type { FiatCurrency } from '@core/config/FiatCurrency'

import type { Balance, Token } from '../types'
import { CacheScope, type CacheService } from './CacheService'

/**
 * Service for fetching cryptocurrency prices and calculating fiat values
 *
 * Features:
 * - Fetches prices from Vultisig API (proxied CoinGecko)
 * - Caches prices with configurable TTL (via CacheService)
 * - Supports native coins and ERC-20 tokens
 * - Batch price fetching for efficiency
 * - Multi-currency support (USD, EUR, GBP, etc.)
 *
 * @example
 * ```typescript
 * const service = new FiatValueService(cacheService, () => 'usd', () => tokens)
 *
 * // Get single price
 * const ethPrice = await service.getPrice(Chain.Ethereum)
 *
 * // Get token price
 * const usdcPrice = await service.getPrice(Chain.Ethereum, '0xA0b86991...')
 *
 * // Calculate balance value
 * const value = await service.getBalanceValue(balance, 'usd')
 * ```
 */
export class FiatValueService {
  constructor(
    private cacheService: CacheService,
    private getCurrency: () => FiatCurrency,
    private getTokens: () => Record<string, Token[]>,
    private getChains: () => Chain[],
    private getBalance: (chain: Chain, tokenId?: string) => Promise<Balance>
  ) {}

  /**
   * Get current price for a chain's native token or specific token
   * Uses CacheService with configurable TTL
   *
   * @param chain Chain to get price for
   * @param tokenId Optional token contract address (omit for native token)
   * @param fiatCurrency Optional currency override (defaults to vault currency)
   * @returns Current price in specified fiat currency
   *
   * @example
   * ```typescript
   * // Native token price
   * const ethPrice = await service.getPrice(Chain.Ethereum, undefined, 'usd')
   * console.log(`1 ETH = $${ethPrice}`)
   *
   * // Token price (ERC-20 USDC)
   * const usdcPrice = await service.getPrice(
   *   Chain.Ethereum,
   *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
   *   'usd'
   * )
   * console.log(`1 USDC = $${usdcPrice}`)
   * ```
   */
  async getPrice(chain: Chain, tokenId?: string, fiatCurrency?: FiatCurrency): Promise<number> {
    const currency = fiatCurrency ? fiatCurrency : this.getCurrency()
    const key = `${chain.toLowerCase()}:${tokenId ?? 'native'}:${currency}`

    // Check scoped cache (uses configured TTL)
    const cached = this.cacheService.getScoped<number>(key, CacheScope.PRICE)
    if (cached !== null) {
      return cached
    }

    // Fetch fresh price
    let price: number

    if (tokenId) {
      // Token price (ERC-20, etc.)
      price = await this.fetchTokenPrice(chain, tokenId, currency)
    } else {
      // Native token price
      price = await this.fetchNativePrice(chain, currency)
    }

    // Cache the price
    await this.cacheService.setScoped(key, CacheScope.PRICE, price)

    return price
  }

  /**
   * Get prices for multiple chains at once
   * More efficient than individual calls - uses batch API endpoints
   *
   * @param chains Array of chains to fetch prices for
   * @param fiatCurrency Optional currency override
   * @returns Map of chain to price
   *
   * @example
   * ```typescript
   * const prices = await service.getPrices(
   *   [Chain.Ethereum, Chain.Bitcoin, Chain.Solana],
   *   'usd'
   * )
   * console.log(prices)
   * // { Ethereum: 3000, Bitcoin: 50000, Solana: 100 }
   * ```
   */
  async getPrices(chains: Chain[], fiatCurrency?: FiatCurrency): Promise<Record<string, number>> {
    const currency = fiatCurrency ?? this.getCurrency()
    const prices: Record<string, number> = {}

    // Separate cached and uncached
    const uncached: Chain[] = []
    for (const chain of chains) {
      const key = `${chain.toLowerCase()}:native:${currency}`
      const cached = this.cacheService.getScoped<number>(key, CacheScope.PRICE)

      if (cached !== null) {
        prices[chain] = cached
      } else {
        uncached.push(chain)
      }
    }

    // Batch fetch uncached prices
    if (uncached.length > 0) {
      const freshPrices = await this.batchFetchNativePrices(uncached, currency)

      // Merge and cache
      for (const [chain, price] of Object.entries(freshPrices)) {
        prices[chain] = price
        const key = `${chain.toLowerCase()}:native:${currency}`
        await this.cacheService.setScoped(key, CacheScope.PRICE, price)
      }
    }

    return prices
  }

  /**
   * Calculate fiat value for a balance
   * Combines balance amount with current price
   *
   * @param balance Balance to calculate value for
   * @param fiatCurrency Optional currency override
   * @returns Fiat value as decimal number
   *
   * @example
   * ```typescript
   * const balance = {
   *   amount: '1500000000000000000', // 1.5 ETH in wei
   *   decimals: 18,
   *   symbol: 'ETH',
   *   chainId: Chain.Ethereum
   * }
   *
   * const value = await service.getBalanceValue(balance, 'usd')
   * console.log(`$${value.toFixed(2)}`) // e.g., "$4500.00"
   * ```
   */
  async getBalanceValue(balance: Balance, fiatCurrency?: FiatCurrency): Promise<number> {
    // Get current price
    const price = await this.getPrice(balance.chainId as Chain, balance.tokenId, fiatCurrency)

    // Calculate value using core utility
    return getCoinValue({
      amount: BigInt(balance.amount),
      decimals: balance.decimals,
      price,
    })
  }

  /**
   * Calculate total portfolio value across multiple balances
   *
   * @param balances Array of balances or record of balances
   * @param fiatCurrency Optional currency override
   * @returns Total portfolio value
   *
   * @example
   * ```typescript
   * const balances = {
   *   'eth': { amount: '1000000000000000000', decimals: 18, ... },
   *   'btc': { amount: '50000000', decimals: 8, ... }
   * }
   *
   * const total = await service.getPortfolioValue(balances, 'usd')
   * console.log(`Total: $${total.toFixed(2)}`)
   * ```
   */
  async getPortfolioValue(balances: Balance[] | Record<string, Balance>, fiatCurrency?: FiatCurrency): Promise<number> {
    const balanceArray = Array.isArray(balances) ? balances : Object.values(balances)

    // Calculate all values in parallel
    const values = await Promise.all(
      balanceArray.map(balance =>
        this.getBalanceValue(balance, fiatCurrency).catch(error => {
          // Don't fail entire portfolio on single token error
          console.warn(`Failed to get value for ${balance.symbol}:`, error.message)
          return 0
        })
      )
    )

    // Sum all values
    return values.reduce((sum, value) => sum + value, 0)
  }

  /**
   * Clear all cached prices to force fresh fetch
   * Useful when user explicitly requests price refresh
   *
   * @example
   * ```typescript
   * // User clicks "Refresh Prices" button
   * await service.clearPrices()
   * await vault.updateValues('all')
   * ```
   */
  async clearPrices(): Promise<void> {
    // Clear only price-related cache entries (not addresses or balances!)
    await this.cacheService.invalidateScope(CacheScope.PRICE)
  }

  /**
   * Get fiat value for a specific asset
   * Combines balance and price data to calculate current value
   *
   * @param chain Chain to get value for
   * @param tokenId Optional token contract address (omit for native token)
   * @param fiatCurrency Optional currency override (defaults to vault currency)
   * @returns Current value in specified fiat currency
   *
   * @example
   * ```typescript
   * // Get ETH value in vault's currency
   * const ethValue = await service.getValue(Chain.Ethereum)
   * console.log(`ETH value: ${ethValue.currency} ${ethValue.amount}`)
   *
   * // Get USDC value in EUR
   * const usdcValue = await service.getValue(
   *   Chain.Ethereum,
   *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
   *   'eur'
   * )
   * ```
   */
  async getValue(
    chain: Chain,
    tokenId?: string,
    fiatCurrency?: FiatCurrency
  ): Promise<{ amount: string; currency: FiatCurrency; lastUpdated: number }> {
    try {
      // Get current balance
      const balance = await this.getBalance(chain, tokenId)

      // Calculate fiat value (normalize currency to lowercase)
      const currency = (fiatCurrency ?? this.getCurrency()).toLowerCase() as FiatCurrency

      const value = await this.getBalanceValue(balance, currency)

      return {
        amount: value.toFixed(2),
        currency,
        lastUpdated: Date.now(),
      }
    } catch (error) {
      throw new Error(`Failed to get value for ${chain}${tokenId ? `:${tokenId}` : ''}: ${(error as Error).message}`)
    }
  }

  /**
   * Get fiat values for all assets on a chain (native + tokens)
   *
   * @param chain Chain to get values for
   * @param fiatCurrency Optional currency override
   * @returns Record of asset ID to Value
   *
   * @example
   * ```typescript
   * const values = await service.getValues(Chain.Ethereum)
   * console.log('Native ETH:', values.native.amount)
   * console.log('USDC:', values['0xA0b86991...'].amount)
   * ```
   */
  async getValues(
    chain: Chain,
    fiatCurrency?: FiatCurrency
  ): Promise<Record<string, { amount: string; currency: FiatCurrency; lastUpdated: number }>> {
    const values: Record<string, { amount: string; currency: FiatCurrency; lastUpdated: number }> = {}

    try {
      // Get native token value
      values.native = await this.getValue(chain, undefined, fiatCurrency)
    } catch (error) {
      console.warn(`Failed to get native value for ${chain}:`, error)
    }

    // Get all token values
    const allTokens = this.getTokens()
    const tokens = allTokens[chain] || []

    for (const token of tokens) {
      try {
        values[token.contractAddress] = await this.getValue(chain, token.contractAddress, fiatCurrency)
      } catch (error) {
        console.warn(`Failed to get value for token ${token.contractAddress}:`, error)
        // Continue with other tokens
      }
    }

    return values
  }

  /**
   * Get total portfolio value across all chains and tokens
   * Uses 1-minute cache to avoid excessive calculations
   *
   * @param fiatCurrency Optional currency override
   * @returns Total portfolio value
   *
   * @example
   * ```typescript
   * const total = await service.getTotalValue()
   * console.log(`Total portfolio: ${total.currency} ${total.amount}`)
   * ```
   */
  async getTotalValue(
    fiatCurrency?: FiatCurrency
  ): Promise<{ amount: string; currency: FiatCurrency; lastUpdated: number }> {
    // Normalize currency to lowercase
    const currency = (fiatCurrency ?? this.getCurrency()).toLowerCase() as FiatCurrency

    // Use scoped cache with configured TTL
    return this.cacheService.getOrComputeScoped(currency, CacheScope.PORTFOLIO, async () => {
      // Calculate fresh total
      const chains = this.getChains()
      let total = 0

      // Sum values across all chains
      for (const chain of chains) {
        try {
          const chainValues = await this.getValues(chain, currency)
          for (const value of Object.values(chainValues)) {
            total += parseFloat(value.amount)
          }
        } catch (error) {
          console.warn(`Failed to get values for ${chain}:`, error)
          // Continue with other chains
        }
      }

      return {
        amount: total.toFixed(2),
        currency,
        lastUpdated: Date.now(),
      }
    })
  }

  /**
   * Refresh price data for specified chain or all chains
   * Clears price cache to force fresh fetch
   *
   * @param chain Chain to update ('all' for all chains)
   *
   * @example
   * ```typescript
   * // Update prices for Ethereum
   * await service.updateValues(Chain.Ethereum)
   *
   * // Update prices for all chains
   * await service.updateValues('all')
   * ```
   */
  async updateValues(chain: Chain | 'all'): Promise<void> {
    // Clear price cache to force fresh fetch
    await this.clearPrices()

    if (chain === 'all') {
      // Fetch values for all chains (triggers fresh price fetch)
      const chains = this.getChains()
      await Promise.all(chains.map(c => this.getValues(c)))
    } else {
      // Fetch values for specific chain
      await this.getValues(chain)
    }
  }

  /**
   * Force recalculation of total portfolio value (invalidates cache)
   *
   * @param fiatCurrency Optional currency override
   * @returns Updated total portfolio value
   *
   * @example
   * ```typescript
   * // Force fresh calculation
   * const total = await service.updateTotalValue()
   * console.log(`Updated total: ${total.currency} ${total.amount}`)
   * ```
   */
  async updateTotalValue(
    fiatCurrency?: FiatCurrency
  ): Promise<{ amount: string; currency: FiatCurrency; lastUpdated: number }> {
    // Normalize currency to lowercase
    const currency = (fiatCurrency ?? this.getCurrency()).toLowerCase() as FiatCurrency

    // Invalidate cache to force recalculation
    await this.cacheService.invalidateScoped(currency, CacheScope.PORTFOLIO)

    // Get fresh value (will recompute)
    return this.getTotalValue(currency)
  }

  // ========== PRIVATE METHODS ==========

  /**
   * Fetch native token price for a single chain
   * @private
   */
  private async fetchNativePrice(chain: Chain, currency: FiatCurrency): Promise<number> {
    const priceProviderId = this.getPriceProviderId(chain)

    const prices = await getCoinPrices({
      ids: [priceProviderId],
      fiatCurrency: currency,
    })

    const price = prices[priceProviderId]
    if (price === undefined || price === 0) {
      throw new Error(`Price not found for ${chain} (priceProviderId: ${priceProviderId})`)
    }

    return price
  }

  /**
   * Batch fetch native token prices for multiple chains
   * @private
   */
  private async batchFetchNativePrices(chains: Chain[], currency: FiatCurrency): Promise<Record<string, number>> {
    const priceProviderIds = chains.map(chain => this.getPriceProviderId(chain))

    const rawPrices = await getCoinPrices({
      ids: priceProviderIds,
      fiatCurrency: currency,
    })

    // Map back from priceProviderId to chain
    const prices: Record<string, number> = {}
    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i]
      const priceProviderId = priceProviderIds[i]
      const price = rawPrices[priceProviderId]

      if (price !== undefined && price !== 0) {
        prices[chain] = price
      }
    }

    return prices
  }

  /**
   * Fetch token price by contract address
   * Currently supports EVM chains (Ethereum, Polygon, BSC, etc.)
   * @private
   */
  private async fetchTokenPrice(chain: Chain, tokenAddress: string, currency: FiatCurrency): Promise<number> {
    // Check if chain supports ERC-20 pricing
    const isEvmChain = this.isEvmChain(chain)

    if (!isEvmChain) {
      throw new Error(`Token pricing not supported for ${chain} (non-EVM chain)`)
    }

    // Fetch ERC-20 token price
    const prices = await getErc20Prices({
      ids: [tokenAddress],
      chain: chain as EvmChain,
      fiatCurrency: currency,
    })

    const price = prices[tokenAddress.toLowerCase()]
    if (price === undefined || price === 0) {
      throw new Error(`Price not found for token ${tokenAddress} on ${chain}`)
    }

    return price
  }

  /**
   * Get CoinGecko price provider ID for a chain
   * Uses priceProviderId from chainFeeCoin metadata
   * @private
   */
  private getPriceProviderId(chain: Chain): string {
    const feeCoin = chainFeeCoin[chain]
    if (!feeCoin || !feeCoin.priceProviderId) {
      throw new Error(`No price provider ID found for chain: ${chain}`)
    }
    return feeCoin.priceProviderId
  }

  /**
   * Check if chain is an EVM chain (supports ERC-20 pricing)
   * @private
   */
  private isEvmChain(chain: Chain): boolean {
    const evmChains = [
      'Ethereum',
      'Polygon',
      'BNBChain',
      'Avalanche',
      'Arbitrum',
      'Optimism',
      'Base',
      'Blast',
      'CronosChain',
      'ZkSync',
      'Mantle',
      'Sei',
    ]
    return evmChains.includes(chain)
  }
}
