import { Chain, CosmosChain, EvmChain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'

/**
 * Terra-family chains (Terra v2/phoenix-1, TerraClassic/columbus-5) that
 * route swaps through Skip Go's bridge rather than a native/general
 * aggregator quote. Keep this narrower than `isSkipRoutableChain` for the
 * few call sites that genuinely need to special-case Terra specifically
 * (e.g. a THORChain/MayaChain discoverer returning a no-pools-anymore hint).
 */
const TERRA_CHAINS: ReadonlySet<Chain> = new Set([CosmosChain.Terra, CosmosChain.TerraClassic])

export const isTerraChain = (chain: string): boolean => TERRA_CHAINS.has(chain as Chain)

/**
 * Cosmos-family chains Skip Go indexes as source/destination chains for its
 * IBC + Osmosis-poolmanager swap routes. Deliberately NOT "any Cosmos
 * chain" — THORChain and MayaChain are native-RUNE/CACAO providers with
 * their own dedicated quote APIs; Skip does not route through them.
 *
 * Each entry below was verified live against Skip's `/v2/fungible/route`
 * endpoint before being added (see the consuming apps' git history for the
 * probe dates) — do not add a chain here on assumption alone.
 */
const SKIP_ROUTABLE_COSMOS_CHAINS: ReadonlySet<Chain> = new Set([
  CosmosChain.Cosmos,
  CosmosChain.Osmosis,
  CosmosChain.Kujira,
  CosmosChain.Terra,
  CosmosChain.TerraClassic,
  CosmosChain.Akash,
  CosmosChain.Dydx,
  CosmosChain.Noble,
])

/**
 * True when the chain participates in a Skip-routed swap pair (as either
 * the source or destination side of `willRouteViaSkip`). Use this in
 * routing predicates ("should we try Skip for this pair?"); use
 * `isTerraChain` only for the narrower Terra-specific special cases.
 */
export const isSkipRoutableChain = (chain: string): boolean => SKIP_ROUTABLE_COSMOS_CHAINS.has(chain as Chain)

/**
 * EVM chains Skip Go bridges cosmos-side liquidity to/from (e.g. ATOM ->
 * USDC.eth via CCTP/Axelar). Skip does not bridge to every EVM chain — only
 * probe-verified entries are listed.
 */
const SKIP_SUPPORTED_EVM_CHAINS: ReadonlySet<Chain> = new Set([
  EvmChain.Ethereum,
  EvmChain.Arbitrum,
  EvmChain.Optimism,
  EvmChain.Base,
  EvmChain.Polygon,
  EvmChain.Avalanche,
  EvmChain.BSC,
])

const isSkipSupportedEvmChain = (chain: string): boolean =>
  isChainOfKind(chain as Chain, 'evm') && SKIP_SUPPORTED_EVM_CHAINS.has(chain as Chain)

/**
 * Single source of truth for "does this from/to chain pair route through
 * Skip Go?" — the gate every consumer (execute/build tools, route
 * discovery/listing, destination-format validation) must share so they can
 * never drift from each other. A pair routes via Skip when ANY of:
 *
 *   - skipBoth:       both sides are Skip-routable cosmos chains (ATOM<->OSMO).
 *   - terraTouching:  either side is Terra v2 / TerraClassic (Skip bridge).
 *   - cosmosEvmCross: one side is Skip-routable cosmos AND the other is a
 *                      Skip-supported EVM chain (ATOM->USDC.eth via CCTP/Axelar).
 *
 * A consumer whose Skip-routing decision drifts from its own destination-
 * validation or route-discovery logic (two independently-maintained copies
 * of this same chain-topology knowledge, one per consumer) is exactly the
 * bug class this function exists to close — accept a raw, uncanonicalized
 * chain string here and it fails closed to `false` (falls through to the
 * caller's native/general-aggregator lane) rather than silently guessing.
 */
export const willRouteViaSkip = (fromChain: string, toChain: string): boolean => {
  const cosmosEvmCross =
    (isSkipRoutableChain(fromChain) && isSkipSupportedEvmChain(toChain)) ||
    (isSkipRoutableChain(toChain) && isSkipSupportedEvmChain(fromChain))
  const skipBoth = isSkipRoutableChain(fromChain) && isSkipRoutableChain(toChain)
  const terraTouching = isTerraChain(fromChain) || isTerraChain(toChain)
  return skipBoth || terraTouching || cosmosEvmCross
}
