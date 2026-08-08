import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { type AccountCoinKey, accountCoinKeyToString } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { getEvmChainBalances } from '@vultisig/core-chain/coin/balance/getEvmChainBalances'
import { normalizeTokenId } from '@vultisig/core-chain/utils/isValidTokenId'
import type { Address } from 'viem'

import { formatBalance } from '../../adapters/formatBalance'
import { CacheScope, type CacheService } from '../../services/CacheService'
import type { Balance, Token } from '../../types'
import { resolveTokenRef, stripLegacyTokenIdPrefix, tokenIdsMatch } from '../tokenRef'
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
    return this.getBalanceForAsset(chain, tokenId)
  }

  private async getBalanceForAsset(
    chain: Chain,
    tokenId?: string,
    knownAssetId?: string,
    knownToken?: Token
  ): Promise<Balance> {
    const key = `${chain.toLowerCase()}:${tokenId ?? 'native'}`

    // Check scoped cache (uses configured TTL)
    const cached = this.cacheService.getScoped<Balance>(key, CacheScope.BALANCE)
    if (cached) return cached

    let address: string | undefined
    try {
      // User-facing refs are resolved at the VaultBase boundary. This service
      // receives an already-canonical asset id; resolving it again could treat
      // a contract address as an untrusted sibling token's symbol.
      const assetId = knownAssetId ?? tokenId

      address = await this.getAddress(chain)

      // Core handles balance fetching for ALL chains
      // Supports: native, ERC-20, SPL, wasm tokens automatically
      const rawBalance = await getCoinBalance({
        chain,
        address,
        id: assetId, // Contract address / chain-level asset id, never the vault's storage key
      })

      // Format using adapter
      const tokens = knownToken ? { [chain]: [knownToken] } : this.getTokensRecord()
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
        const assetId = normalizeTokenId({
          chain,
          id: stripLegacyTokenIdPrefix(chain, token.contractAddress || token.id),
        })
        const resultId = stripLegacyTokenIdPrefix(chain, token.id)
        balanceRequests.push(
          this.getBalanceForAsset(chain, token.id, assetId, token).then(
            balance => [`${chain}:${resultId}`, balance] as const
          )
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
      token?: Token
    }

    const requests: CoinRequest[] = [
      { coinKey: { chain, address }, resultKey: chain, cacheKey: `${chain.toLowerCase()}:native` },
      ...tokens.map(token => {
        // This record is already selected. Use its own chain-level asset id
        // instead of resolving its storage key against sibling symbols.
        const assetId = normalizeTokenId({
          chain,
          id: stripLegacyTokenIdPrefix(chain, token.contractAddress || token.id),
        })
        return {
          coinKey: { chain, id: assetId, address } as AccountCoinKey<EvmChain>,
          resultKey: `${chain}:${stripLegacyTokenIdPrefix(chain, token.id)}`,
          cacheKey: `${chain.toLowerCase()}:${token.id}`,
          tokenId: token.id,
          token,
        }
      }),
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
      const rawBalance = rawBalances[accountCoinKeyToString(request.coinKey)]
      // A key MISSING from the multicall result means that coin was omitted/failed (a transient RPC
      // hiccup, a partial Multicall3 aggregate). The old per-coin path cached NOTHING on failure; caching
      // a fabricated 0n here (5min TTL) would show a real 0 for a coin the user owns AND emit it as a real
      // balanceUpdated. Only cache + emit keys the multicall actually RETURNED (a genuine 0n from the
      // aggregate IS a real balance and is kept); a missing key falls through uncached + unemitted so the
      // next call refetches. It's still returned for this call so the shape is complete.
      const present = rawBalance !== undefined
      const formatTokens = request.token ? { [chain]: [request.token] } : tokensRecord
      const balance = formatBalance(present ? rawBalance : 0n, chain, request.tokenId, formatTokens)

      if (present) {
        await this.cacheService.setScoped(request.cacheKey, CacheScope.BALANCE, balance)
        this.emitBalanceUpdated({ chain, balance, tokenId: request.tokenId })
      }

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
   * @important ATOMICITY: `getAllTokens()` hands back live vault state, so the
   * new token is applied as a fresh record/array rather than pushed in place —
   * that keeps the pre-add state intact as a rollback target. If saveVault()
   * fails the previous state is restored and the error rethrown, matching
   * removeToken(). Any async validation you add must still run BEFORE the state
   * is applied; see addChain() in PreferencesService for the same pattern.
   */
  async addToken(chain: Chain, token: Token): Promise<void> {
    const allTokens = this.getAllTokens()
    const chainTokens = allTokens[chain] ?? []

    // Canonicalise the id (and matching contractAddress) before the token enters
    // persisted state, so a manually added token — e.g. a Ripple issued currency
    // entered by its human ticker `RLUSD.<issuer>` — dedupes against the on-ledger
    // id discovery stores (`524C…<issuer>`) instead of being kept as a second,
    // distinct token. A no-op for chains whose ids are already canonical.
    const id = normalizeTokenId({ chain, id: token.id })
    const normalizedToken: Token =
      token.contractAddress === undefined
        ? { ...token, id }
        : { ...token, id, contractAddress: normalizeTokenId({ chain, id: token.contractAddress }) }

    // Check if this chain-level asset already exists. Older CLI versions stored
    // `<Chain>-<address>` ids, so exact-id comparison can create a second record
    // when that same contract is added again under its canonical bare id.
    const normalizedAssetId = normalizedToken.contractAddress || normalizedToken.id
    const tokenAlreadyExists = chainTokens.some(t => tokenIdsMatch(chain, t.contractAddress || t.id, normalizedAssetId))
    if (!tokenAlreadyExists) {
      this.setAllTokens({ ...allTokens, [chain]: [...chainTokens, normalizedToken] })

      try {
        await this.saveVault()
      } catch (error) {
        // Persistence failed — drop the optimistic add so a later successful
        // save can't quietly persist a token the caller was told failed.
        this.setAllTokens(allTokens)
        throw error
      }

      // Emit token added event
      this.emitTokenAdded({ chain, token: normalizedToken })
    }
  }

  /**
   * Remove token from chain
   * Emits tokenRemoved event and invalidates balance cache
   *
   * @param chain Chain to remove token from
   * @param tokenId Token ID (contract address) to remove
   */
  async removeToken(chain: Chain, tokenId: string): Promise<boolean> {
    const allTokens = this.getAllTokens()
    const tokens = allTokens[chain]

    // Match the canonical id addToken persisted, so a raw id — e.g. a Ripple
    // human-ticker `RLUSD.<issuer>` — still removes the stored token.
    const id = normalizeTokenId({ chain, id: tokenId })

    if (!tokens) return false

    // Preserve the pre-existing escape hatch for malformed tracked records
    // whose stored id is empty. The shared resolver interprets an empty ref as
    // native, but the exact empty storage id was removable before this method
    // adopted resolver-based matching.
    let tokenIndex = id === '' ? tokens.findIndex(token => token.id === '') : -1

    if (id !== '') {
      // Resolve first. The resolver is the single definition of what a token
      // reference means, and removal must not disagree with the asset that
      // `send`/`swap` would pick for the same reference.
      let resolved
      try {
        resolved = resolveTokenRef(chain, id, tokens)
      } catch {
        return false
      }

      if (!resolved.contractAddress) return false

      // Select the record the RESOLVER selected, by mirroring its own user-token
      // lookup order (tokenRef.ts): symbol first, then contract address or stored
      // id. Reconstructing the choice from the resolved asset id instead is not
      // equivalent — a vault can hold two records for one contract under
      // different symbols, or a ticker-keyed id (`id: 'usdc'`) alongside the
      // address-keyed record, and then "which record" and "which asset" are
      // different questions. Removal must mean the same record every other
      // surface means for that reference.
      const upper = id.toUpperCase()
      tokenIndex = tokens.findIndex(token => token.symbol?.toUpperCase() === upper)
      if (tokenIndex === -1) {
        const lower = id.toLowerCase()
        tokenIndex = tokens.findIndex(
          token => token.contractAddress?.toLowerCase() === lower || token.id?.toLowerCase() === lower
        )
      }
      if (tokenIndex === -1) {
        tokenIndex = tokens.findIndex(
          token => tokenIdsMatch(chain, token.contractAddress, id) || tokenIdsMatch(chain, token.id, id)
        )
      }
      if (tokenIndex === -1) {
        // The ref resolved through the well-known registry rather than a stored
        // record. Fall back to the asset id, using the same `||` fallback the
        // resolver applies — a token stored with an empty `contractAddress` is
        // identified by its `id`, and `??` would compare it against `''` and
        // leave it permanently unremovable.
        const resolvedAssetId = resolved.contractAddress
        tokenIndex = tokens.findIndex(token => tokenIdsMatch(chain, token.contractAddress || token.id, resolvedAssetId))
      }
    }

    if (tokenIndex === -1) return false

    // Store original state for rollback
    const originalTokens = { ...allTokens }
    const removedToken = tokens[tokenIndex]

    // Optimistically remove the resolved token
    allTokens[chain] = tokens.filter((_, index) => index !== tokenIndex)
    this.setAllTokens(allTokens)

    try {
      // Attempt to persist changes
      await this.saveVault()

      // Emit token removed event only after successful save
      this.emitTokenRemoved({ chain, tokenId: removedToken.id })
      return true
    } catch (error) {
      // Rollback on failure to maintain consistency
      this.setAllTokens(originalTokens)
      throw error
    }
  }
}
