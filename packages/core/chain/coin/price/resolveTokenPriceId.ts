import type { Chain } from '../../Chain'
import { chainFeeCoin } from '../chainFeeCoin'
import { knownTokensIndex } from '../knownTokens'

/**
 * Resolve a token's CoinGecko price-provider id from the SDK's curated
 * registry. Pure synchronous lookup, no I/O.
 *
 * - When `denomOrAddress` is omitted, returns the native chain coin's
 *   priceProviderId from chainFeeCoin (e.g. resolveTokenPriceId('Ethereum')
 *   -> 'ethereum').
 * - When `denomOrAddress` is provided, looks up the entry in
 *   knownTokensIndex[chain] and returns its priceProviderId. The lookup is
 *   case-insensitive (the index stores all keys lowercased).
 *
 * Returns `undefined` if no registry entry exists — caller decides whether
 * to fall back to CoinGecko search, DeFiLlama, or surface a
 * `price_unavailable` to the user.
 *
 * Referenced by vultisig/mcp-ts#255 — registry-driven price resolution.
 */
export function resolveTokenPriceId(chain: Chain, denomOrAddress?: string): string | undefined {
  if (!denomOrAddress) {
    return chainFeeCoin[chain]?.priceProviderId || undefined
  }
  const normalized = denomOrAddress.toLowerCase()
  return knownTokensIndex[chain]?.[normalized]?.priceProviderId || undefined
}
