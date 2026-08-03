import type { Chain } from '../../Chain'
import { getChainKind } from '../../ChainKind'
import { cosmosFeeCoinDenom } from '../../chains/cosmos/cosmosFeeCoinDenom'
import { chainFeeCoin } from '../chainFeeCoin'
import { knownTokens, knownTokensIndex } from '../knownTokens'

/**
 * Resolve a token's CoinGecko price-provider id from the SDK's curated
 * registry. Pure synchronous lookup, no I/O.
 *
 * - When `denomOrAddress` is omitted, empty, or whitespace-only, returns the
 *   native chain coin's priceProviderId from chainFeeCoin (e.g.
 *   resolveTokenPriceId('Ethereum') -> 'ethereum').
 * - When `denomOrAddress` is provided, incidental surrounding whitespace is
 *   trimmed. EVM contract addresses are matched case-insensitively; identifiers
 *   for every other chain are matched exactly because Solana mints, Cosmos
 *   denoms, TON jettons, and other non-EVM identifiers may be case-sensitive.
 *
 * The native Cosmos fee denom is also resolved to its chain fee coin's
 * priceProviderId. Other unknown identifiers return `undefined` — the caller
 * decides whether to fall back to CoinGecko search, DeFiLlama, or surface a
 * `price_unavailable` to the user.
 *
 * Referenced by vultisig/mcp-ts#255 — registry-driven price resolution.
 */
export function resolveTokenPriceId(chain: Chain, denomOrAddress?: string): string | undefined {
  const identifier = denomOrAddress?.trim()
  if (!identifier) {
    return chainFeeCoin[chain]?.priceProviderId || undefined
  }

  const knownPriceProviderId =
    getChainKind(chain) === 'evm'
      ? knownTokensIndex[chain]?.[identifier.toLowerCase()]?.priceProviderId
      : knownTokens[chain]?.find(coin => coin.id === identifier)?.priceProviderId
  if (knownPriceProviderId) return knownPriceProviderId

  return cosmosFeeCoinDenom[chain as keyof typeof cosmosFeeCoinDenom] === identifier
    ? chainFeeCoin[chain]?.priceProviderId || undefined
    : undefined
}
