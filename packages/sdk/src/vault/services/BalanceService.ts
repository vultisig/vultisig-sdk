import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { type AccountCoinKey, accountCoinKeyToString } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { getEvmChainBalances } from '@vultisig/core-chain/coin/balance/getEvmChainBalances'
import type { Address } from 'viem'

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
  async getBalances({
    chains,
    includeTokens = false,
  }: {
    chains: Chain | Chain[]
    includeTokens?: boolean
  }): Promise<Record<string, Balance>> {
    const result: Record<string, Balance> = {}
    const chainsList = Array.isArray(chains) ? chains : [chains]

    await Promise.all(
      chainsList.map(async chain => {
        try {
          // EVM chains fetch native + all tokens in a single Multicall3 round-trip
          // instead of one RPC per token (N+1). Non-EVM chains keep the per-coin path.
          const entries =
            includeTokens && getChainKind(chain) === 'evm'
              ? await this.getEvmBalancesBatched(chain as EvmChain)
              : await this.getBalancesPerCoin(chain, includeTokens)

          for (const [key, balance] of entries) {
            result[key] = balance
          }
        } catch (error) {
          console.warn(`Failed to fetch balance for ${chain}:`, error)
        }
      })
    )

    return result
  }

  /**
   * Fetch native + token balances for a single chain, one coin per request.
   * Used for non-EVM chains and native-only lookups.
   */
  private async getBalancesPerCoin(chain: Chain, includeTokens: boolean): Promise<Array<readonly [string, Balance]>> {
    const balanceRequests: Array<Promise<readonly [string, Balance]>> = [
      this.getBalance(chain).then(balance => [chain as string, balance] as const),
    ]

    if (includeTokens) {
      const tokens = this.getTokens(chain)
      for (const token of tokens) {
        balanceRequests.push(
          this.getBalance(chain, token.id).then(balance => [`${chain}:${token.id}`, balance] as const)
        )
      }
    }

    return Promise.all(balanceRequests)
  }

  /**
   * Fetch native + token balances for a single EVM chain in one Multicall3 call.
   * Respects the per-coin BALANCE cache, only multicalling the uncached coins,
   * and caches/emits each fetched balance exactly like getBalance() does.
   */
  private async getEvmBalancesBatched(chain: EvmChain): Promise<Array<readonly [string, Balance]>> {
    const address = await this.getAddress(chain)
    const tokens = this.getTokens(chain)

    type CoinRequest = {
      coinKey: AccountCoinKey<EvmChain>
      resultKey: string
      cacheKey: string
      tokenId?: string
    }

    const requests: CoinRequest[] = [
      { coinKey: { chain, address }, resultKey: chain, cacheKey: `${chain.toLowerCase()}:native` },
      ...tokens.map(token => ({
        coinKey: { chain, id: token.id, address } as AccountCoinKey<EvmChain>,
        resultKey: `${chain}:${token.id}`,
        cacheKey: `${chain.toLowerCase()}:${token.id}`,
        tokenId: token.id,
      })),
    ]

    const entries: Array<readonly [string, Balance]> = []
    const uncached: CoinRequest[] = []
    for (const request of requests) {
      const cached = this.cacheService.getScoped<Balance>(request.cacheKey, CacheScope.BALANCE)
      if (cached) {
        entries.push([request.resultKey, cached] as const)
      } else {
        uncached.push(request)
      }
    }

    if (uncached.length === 0) {
      return entries
    }

    const rawBalances = await getEvmChainBalances({
      chain,
      address: address as Address,
      coins: uncached.map(request => request.coinKey),
    })

    const tokensRecord = this.getTokensRecord()
    for (const request of uncached) {
      const rawBalance = rawBalances[accountCoinKeyToString(request.coinKey)] ?? 0n
      const balance = formatBalance(rawBalance, chain, request.tokenId, tokensRecord)

      await this.cacheService.setScoped(request.cacheKey, CacheScope.BALANCE, balance)
      this.emitBalanceUpdated({ chain, balance, tokenId: request.tokenId })

      entries.push([request.resultKey, balance] as const)
    }

    return entries
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
  async updateBalances({
    chains,
    includeTokens = false,
  }: {
    chains: Chain | Chain[]
    includeTokens?: boolean
  }): Promise<Record<string, Balance>> {
    const chainsList = Array.isArray(chains) ? chains : [chains]

    // Invalidate cache for all chains
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

    return this.getBalances({ chains: chainsList, includeTokens })
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
