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
    private emitBalanceUpdated: (data: { chain: Chain; balance: Balance; tokenId?: string }) => void,
    private emitError: (error: Error) => void,
    private getAddress: (chain: Chain) => Promise<string>,
    private getTokens: (chain: Chain) => Token[],
    private getAllTokens: () => Record<string, Token[]>,
    private setAllTokens: (tokens: Record<string, Token[]>) => void,
    private saveVault: () => Promise<void>,
    private emitTokenAdded: (data: { chain: Chain; token: Token }) => void,
    private emitTokenRemoved: (data: { chain: Chain; tokenId: string }) => void
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
  async getBalances(chains: Chain[], includeTokens = false): Promise<Record<string, Balance>> {
    const result: Record<string, Balance> = {}

    const chainsList = Array.isArray(chains) ? chains : [chains as unknown as Chain]

    for (const chain of chainsList) {
      try {
        // Native balance
        result[chain] = await this.getBalance(chain)

        // Token balances
        if (includeTokens) {
          const tokens = this.getTokens(chain)
          for (const token of tokens) {
            result[`${chain}:${token.id}`] = await this.getBalance(chain, token.id)
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
  async updateBalances(chains: Chain[], includeTokens = false): Promise<Record<string, Balance>> {
    // Invalidate cache for all chains
    const chainsList = Array.isArray(chains) ? chains : [chains as unknown as Chain]
    for (const chain of chainsList) {
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

    return this.getBalances(chainsList, includeTokens)
  }

  /**
   * Get tokens as record for formatBalance adapter
   */
  private getTokensRecord(): Record<string, Token[]> {
    return this.getAllTokens()
  }

  /**
   * Set tokens for a chain (replaces existing list)
   *
   * @param chain Chain to set tokens for
   * @param tokens Array of tokens
   */
  async setTokens(chain: Chain, tokens: Token[]): Promise<void> {
    const allTokens = this.getAllTokens()
    allTokens[chain] = tokens
    this.setAllTokens(allTokens)
    await this.saveVault()
  }

  /**
   * Add single token to chain
   * Emits tokenAdded event and invalidates balance cache
   *
   * @param chain Chain to add token to
   * @param token Token to add
   *
   * @important ATOMICITY WARNING: This method currently mutates state before
   * calling saveVault(). It is SAFE because there is no async validation
   * between mutation and save. However, if you add ANY async validation
   * (e.g., checking token contract existence on-chain), you MUST move that
   * validation BEFORE the state mutation to prevent partial state corruption.
   * See addChain() in PreferencesService for the correct pattern.
   */
  async addToken(chain: Chain, token: Token): Promise<void> {
    const allTokens = this.getAllTokens()

    if (!allTokens[chain]) {
      allTokens[chain] = []
    }

    // Check if token already exists
    if (!allTokens[chain].find(t => t.id === token.id)) {
      // State mutation - SAFE only because no async validation follows
      allTokens[chain].push(token)
      this.setAllTokens(allTokens)
      await this.saveVault()

      // Emit token added event
      this.emitTokenAdded({ chain, token })
    }
  }

  /**
   * Remove token from chain
   * Emits tokenRemoved event and invalidates balance cache
   *
   * @param chain Chain to remove token from
   * @param tokenId Token ID (contract address) to remove
   */
  async removeToken(chain: Chain, tokenId: string): Promise<void> {
    const allTokens = this.getAllTokens()

    if (allTokens[chain]) {
      const tokenExists = allTokens[chain].some(t => t.id === tokenId)

      if (tokenExists) {
        // Store original state for rollback
        const originalTokens = { ...allTokens }

        // Optimistically remove token
        allTokens[chain] = allTokens[chain].filter(t => t.id !== tokenId)
        this.setAllTokens(allTokens)

        try {
          // Attempt to persist changes
          await this.saveVault()

          // Emit token removed event only after successful save
          this.emitTokenRemoved({ chain, tokenId })
        } catch (error) {
          // Rollback on failure to maintain consistency
          this.setAllTokens(originalTokens)
          throw error
        }
      }
    }
  }
}
