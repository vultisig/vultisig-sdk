import type { Chain } from '../../Chain'
import { chainFeeCoin } from '../chainFeeCoin'
import { getKnownTokenById } from '../knownTokens'

/**
 * Resolve a token's CoinGecko price-provider id from the SDK's curated
 * registry. Pure synchronous lookup, no I/O.
 *
 * - When `denomOrAddress` is omitted, empty, or whitespace-only, returns the
 *   native chain coin's priceProviderId from chainFeeCoin (e.g.
 *   resolveTokenPriceId('Ethereum') -> 'ethereum').
 * - When `denomOrAddress` is provided, it is trimmed, then looked up in the
 *   curated registry. EVM contract-address lookups are case-insensitive;
 *   non-EVM token ids must match their canonical registry ids exactly.
 *
 * Returns `undefined` if no registry entry exists — never guesses or
 * fabricates an id. The caller decides whether to fall back to CoinGecko
 * search, DeFiLlama, or surface a `price_unavailable` to the user.
 *
 * Referenced by vultisig/mcp-ts#255 — registry-driven price resolution.
 */
export function resolveTokenPriceId(chain: Chain, denomOrAddress?: string): string | undefined {
  const normalized = denomOrAddress?.trim()
  if (!normalized) {
    return chainFeeCoin[chain]?.priceProviderId || undefined
  }
  return getKnownTokenById(chain, normalized)?.priceProviderId || undefined
}
