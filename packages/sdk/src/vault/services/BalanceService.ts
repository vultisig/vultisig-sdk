import { Chain } from '@core/chain/Chain'
import { getCoinBalance } from '@core/chain/coin/balance'

import { formatBalance } from '../../adapters/formatBalance'
import type { CacheService } from '../../services/CacheService'
import type { Balance, Token } from '../../types'
import { VaultError, VaultErrorCode } from '../VaultError'

/**
 * BalanceService
 *
 * Handles balance fetching, caching, and updates for vault accounts.
 * Extracted from Vault.ts to reduce file size and improve maintainability.
 */
export class BalanceService {
  constructor(
    private cacheService: CacheService,
    private emitBalanceUpdated: (data: {
      chain: Chain
      balance: Balance
      tokenId?: string
    }) => void,
    private emitError: (error: Error) => void,
    private getAddress: (chain: Chain) => Promise<string>,
    private getTokens: (chain: Chain) => Token[],
    private getAllTokens: () => Record<string, Token[]>
  ) {}

  /**
   * Get balance for chain (with optional token)
   * Uses core's getCoinBalance() with 5-minute TTL cache
   */
  async getBalance(chain: Chain, tokenId?: string): Promise<Balance> {
    const cacheKey = `balance:${chain}:${tokenId ?? 'native'}`

    // Check 5-min TTL cache
    const cached = this.cacheService.get<Balance>(cacheKey, 5 * 60 * 1000)
    if (cached) return cached

    let address: string | undefined
    try {
      address = await this.getAddress(chain)

      // Core handles balance fetching for ALL chains
      // Supports: native, ERC-20, SPL, wasm tokens automatically
      const rawBalance = await getCoinBalance({
        chain,
        address,
        id: tokenId, // Token ID (contract address for ERC-20, etc.)
      })

      // Format using adapter
      const tokens = this.getTokensRecord()
      const balance = formatBalance(rawBalance, chain, tokenId, tokens)

      // Cache with 5-min TTL
      this.cacheService.set(cacheKey, balance)

      // Emit balance updated event
      this.emitBalanceUpdated({
        chain,
        balance,
        tokenId,
      })

      return balance
    } catch (error) {
      // Enhanced error logging for E2E test debugging
      const errorMessage = (error as Error)?.message || 'Unknown error'
      const errorName = (error as Error)?.name || 'Error'

      this.emitError(error as Error)
      throw new VaultError(
        VaultErrorCode.BalanceFetchFailed,
        `Failed to fetch balance for ${chain}${tokenId ? `:${tokenId}` : ''}: ${errorName}: ${errorMessage}`,
        error as Error
      )
    }
  }

  /**
   * Get balances for multiple chains
   */
  async getBalances(
    chains: Chain[],
    includeTokens = false
  ): Promise<Record<string, Balance>> {
    const result: Record<string, Balance> = {}

    for (const chain of chains) {
      try {
        // Native balance
        result[chain] = await this.getBalance(chain)

        // Token balances
        if (includeTokens) {
          const tokens = this.getTokens(chain)
          for (const token of tokens) {
            result[`${chain}:${token.id}`] = await this.getBalance(
              chain,
              token.id
            )
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch balance for ${chain}:`, error)
      }
    }

    return result
  }

  /**
   * Force refresh balance (clear cache)
   */
  async updateBalance(chain: Chain, tokenId?: string): Promise<Balance> {
    const cacheKey = `balance:${chain}:${tokenId ?? 'native'}`
    this.cacheService.clear(cacheKey)
    // getBalance() will emit the balanceUpdated event
    return this.getBalance(chain, tokenId)
  }

  /**
   * Force refresh multiple balances
   */
  async updateBalances(
    chains: Chain[],
    includeTokens = false
  ): Promise<Record<string, Balance>> {
    // Clear cache for all chains
    for (const chain of chains) {
      const cacheKey = `balance:${chain}:native`
      this.cacheService.clear(cacheKey)

      if (includeTokens) {
        const tokens = this.getTokens(chain)
        for (const token of tokens) {
          const tokenCacheKey = `balance:${chain}:${token.id}`
          this.cacheService.clear(tokenCacheKey)
        }
      }
    }

    return this.getBalances(chains, includeTokens)
  }

  /**
   * Get tokens as record for formatBalance adapter
   */
  private getTokensRecord(): Record<string, Token[]> {
    return this.getAllTokens()
  }
}
