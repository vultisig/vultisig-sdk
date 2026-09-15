import { CosmosChain } from '../../Chain'
import { getCosmosChainId } from './chainInfo'

/**
 * Canonical Cosmos-family bech32 HRP (human-readable prefix), keyed by
 * CHAIN-ID rather than the SDK `Chain` enum, so it covers both:
 *
 *   - every first-class Vultisig-supported Cosmos chain (`CosmosChain`,
 *     resolvable to an HRP via `getCosmosChainHrp` below), and
 *   - IBC/Skip DESTINATION chains that are valid transfer/swap targets but
 *     have no wallet/RPC support of their own (e.g. `neutron-1`, `juno-1`,
 *     `stargaze-1`) — these have no `CosmosChain` member to key by.
 *
 * Consolidates what were four independently-maintained, overlapping copies
 * (architecture#1787): `tools/cosmos/gov.ts`'s `CHAIN_HRP`, `tools/prep/
 * ibcTransfer.ts`'s `IBC_CHAIN_HRP`, `tools/swap/skip/skipSwap.ts`'s
 * `COSMOS_CHAIN_HRPS`, and `tools/token/resolveContract.ts`'s
 * `CW20_CHAIN_PREFIX`. Every entry below was cross-checked against all four
 * source tables for the chains they had in common — no value differs across
 * copies, so this union is a lossless merge, not a judgment call on which
 * source wins.
 *
 * Deliberately does NOT absorb `utils/addressFormat.ts`'s `cosmosHRPByChain`
 * / `cosmosValoperByChain` — those are keyed by a THIRD, different space
 * (lowercase "canonical chain tag", not chain-id or `Chain` enum), ported
 * 1:1 from a Go reference (`chain_prefix_extractor.go`) for cross-language
 * parity, and cover additional chains (sei, kava, persistence, secret,
 * crescent, qbtc) this registry has no chain-id for. Forcing that table
 * through this one would risk silently breaking Go parity for no
 * consolidation benefit — a real, but separately-scoped, follow-up.
 */
export const COSMOS_CHAIN_ID_HRP: Record<string, string> = {
  'phoenix-1': 'terra',
  'columbus-5': 'terra',
  'cosmoshub-4': 'cosmos',
  'osmosis-1': 'osmo',
  'kaiyo-1': 'kujira',
  'neutron-1': 'neutron',
  'axelar-dojo-1': 'axelar',
  'injective-1': 'inj',
  'juno-1': 'juno',
  'stargaze-1': 'stars',
  'noble-1': 'noble',
  'akashnet-2': 'akash',
  'dydx-mainnet-1': 'dydx',
  'stride-1': 'stride',
  celestia: 'celestia',
  'thorchain-1': 'thor',
  'mayachain-mainnet-v1': 'maya',
  'agoric-3': 'agoric',
}

/**
 * Resolve the bech32 HRP for a first-class Vultisig `CosmosChain`. Throws on
 * a registry gap (a `CosmosChain` member with no HRP entry above) rather
 * than returning `undefined` — that's a bug in this file, not a caller
 * error, and failing loudly here beats a confusing downstream 404/wrong-HRP
 * address match.
 */
export function getCosmosChainHrp(chain: CosmosChain): string {
  const chainId = getCosmosChainId(chain)
  const hrp = COSMOS_CHAIN_ID_HRP[chainId]
  if (!hrp) {
    throw new Error(`getCosmosChainHrp: no HRP registered for ${chain} (chainId ${chainId})`)
  }
  return hrp
}
