import type { Chain } from '../../Chain'
import { cosmosFeeCoinDenom } from '../../chains/cosmos/cosmosFeeCoinDenom'
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
 * The native Cosmos fee denom is also resolved to its chain fee coin's
 * priceProviderId. Other unknown identifiers return `undefined` — the caller
 * decides whether to fall back to CoinGecko search, DeFiLlama, or surface a
 * `price_unavailable` to the user.
 *
 * Referenced by vultisig/mcp-ts#255 — registry-driven price resolution.
 */
export function resolveTokenPriceId(chain: Chain, denomOrAddress?: string): string | undefined {
  const normalized = denomOrAddress?.trim().toLowerCase()
  if (!normalized) {
    return chainFeeCoin[chain]?.priceProviderId || undefined
  }
  const knownPriceProviderId = knownTokensIndex[chain]?.[normalized]?.priceProviderId
  if (knownPriceProviderId) return knownPriceProviderId

  return cosmosFeeCoinDenom[chain as keyof typeof cosmosFeeCoinDenom] === normalized
    ? chainFeeCoin[chain]?.priceProviderId || undefined
    : undefined
}
