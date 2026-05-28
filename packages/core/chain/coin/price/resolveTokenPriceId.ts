import type { Chain } from '../../Chain'
import { chainFeeCoin } from '../chainFeeCoin'
import { knownTokensIndex } from '../knownTokens'

/**
 * Resolve a token's CoinGecko price-provider id from the SDK's curated
 * registry. Pure synchronous lookup, no I/O.
 *
 * - When `denomOrAddress` is omitted, empty, or whitespace-only, returns the
 *   native chain coin's priceProviderId from chainFeeCoin (e.g.
 *   resolveTokenPriceId('Ethereum') -> 'ethereum').
 * - When `denomOrAddress` is provided, it is trimmed and lowercased, then
 *   looked up in knownTokensIndex[chain]. The lookup is case-insensitive (the
 *   index stores all keys lowercased) and tolerant of incidental surrounding
 *   whitespace from upstream string sources. Note: lowercasing is locale-
 *   independent (String.prototype.toLowerCase, not toLocaleLowerCase) and the
 *   index keys are built with the same call, so the build/lookup casing is
 *   always symmetric.
 *
 * Returns `undefined` if no registry entry exists — never guesses or
 * fabricates an id. The caller decides whether to fall back to CoinGecko
 * search, DeFiLlama, or surface a `price_unavailable` to the user.
 *
 * Referenced by vultisig/mcp-ts#255 — registry-driven price resolution.
 */
export function resolveTokenPriceId(chain: Chain, denomOrAddress?: string): string | undefined {
  const normalized = denomOrAddress?.trim().toLowerCase()
  if (!normalized) {
    return chainFeeCoin[chain]?.priceProviderId || undefined
  }
  return knownTokensIndex[chain]?.[normalized]?.priceProviderId || undefined
}
