import { Chain } from '@core/chain/Chain'
import { getCoinBalance } from '@core/chain/coin/balance'

import { formatBalance } from '../../adapters/formatBalance'
import { CacheScope, type CacheService } from '../../services/CacheService'
import type { Balance, Token } from '../../types'
import { VaultError, VaultErrorCode } from '../VaultError'

/**
 * BalanceService
 *
 * Handles balance fetching, caching, and updates for vault accounts.
 * Uses CacheService with BALANCE scope for automatic TTL-based caching.
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
   * Uses CacheService with automatic TTL-based caching
   */
  async getBalance(chain: Chain, tokenId?: string): Promise<Balance> {
    const key = `${chain.toLowerCase()}:${tokenId ?? 'native'}`

    // Check scoped cache (uses configured TTL)
    const cached = this.cacheService.getScoped<Balance>(key, CacheScope.BALANCE)
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

      // Cache with configured TTL
      await this.cacheService.setScoped(key, CacheScope.BALANCE, balance)

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
   * Force refresh balance (invalidate cache)
   */
  async updateBalance(chain: Chain, tokenId?: string): Promise<Balance> {
    const key = `${chain.toLowerCase()}:${tokenId ?? 'native'}`
    await this.cacheService.invalidateScoped(key, CacheScope.BALANCE)
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
    // Invalidate cache for all chains
    for (const chain of chains) {
      const key = `${chain.toLowerCase()}:native`
      await this.cacheService.invalidateScoped(key, CacheScope.BALANCE)

      if (includeTokens) {
        const tokens = this.getTokens(chain)
        for (const token of tokens) {
          const tokenKey = `${chain.toLowerCase()}:${token.id}`
          await this.cacheService.invalidateScoped(tokenKey, CacheScope.BALANCE)
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
