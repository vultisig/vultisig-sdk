import { CosmosChain } from '@vultisig/core-chain/Chain'

import { getCosmosChainByChainId } from './chainInfo'

/**
 * cosmos-sdk `x/auth.MaxMemoCharacters` default. Every cosmos chain we have
 * live-verified (against its own `/cosmos/auth/v1beta1/params` endpoint) either
 * uses this default or a gov-raised override below — do not add a new override
 * on assumption alone, curl the chain's own auth params first (different
 * chains pick different caps and they can change via governance).
 */
export const COSMOS_MEMO_DEFAULT_MAX_BYTES = 256

/**
 * The `MaxMemoCharacters` decision for every supported cosmos chain. Most use
 * the cosmos-sdk default; keeping those entries explicit makes adding a chain
 * fail typechecking until its cap has been consciously selected.
 */
const COSMOS_MEMO_MAX_BYTES_BY_CHAIN: Record<CosmosChain, number> = {
  [CosmosChain.Osmosis]: COSMOS_MEMO_DEFAULT_MAX_BYTES,
  [CosmosChain.Dydx]: COSMOS_MEMO_DEFAULT_MAX_BYTES,
  [CosmosChain.Kujira]: COSMOS_MEMO_DEFAULT_MAX_BYTES,
  // Terra v2 (phoenix-1): live-verified 512 (2026-06-22, /cosmos/auth params) -
  // Terra raised MaxMemoCharacters above the sdk default.
  [CosmosChain.Terra]: 512,
  [CosmosChain.TerraClassic]: COSMOS_MEMO_DEFAULT_MAX_BYTES,
  [CosmosChain.Noble]: COSMOS_MEMO_DEFAULT_MAX_BYTES,
  [CosmosChain.Akash]: COSMOS_MEMO_DEFAULT_MAX_BYTES,
  // Cosmos Hub (cosmoshub-4): live-verified 512 (2026-06-22, /cosmos/auth params) -
  // gov-raised above the sdk default.
  [CosmosChain.Cosmos]: 512,
  [CosmosChain.THORChain]: COSMOS_MEMO_DEFAULT_MAX_BYTES,
  [CosmosChain.MayaChain]: COSMOS_MEMO_DEFAULT_MAX_BYTES,
}

/**
 * The `x/auth.MaxMemoCharacters` byte cap for a cosmos chain's outer
 * `TxBody.memo` field. A tx whose memo exceeds this is rejected at broadcast
 * with sdk error code 12 ("memo too long") - AFTER the user has already signed,
 * burning the signing ceremony for nothing. Check this before building any
 * cosmos tx with a caller-supplied memo.
 */
export const getCosmosMemoMaxBytes = (chain: CosmosChain): number => COSMOS_MEMO_MAX_BYTES_BY_CHAIN[chain]

/**
 * Same as {@link getCosmosMemoMaxBytes}, keyed by the chain's live chain-id
 * string (e.g. Skip Go route responses identify chains this way, not by the
 * SDK's `CosmosChain` enum). Falls back to the sdk default for an unrecognized
 * chain-id rather than skipping the check.
 */
export const getCosmosMemoMaxBytesByChainId = (chainId: string): number => {
  const chain = getCosmosChainByChainId(chainId)
  return chain !== undefined ? getCosmosMemoMaxBytes(chain) : COSMOS_MEMO_DEFAULT_MAX_BYTES
}

/**
 * Chains that enforce `MaxMemoCharacters` against the **ICS-20 packet memo**
 * (the `memo` field inside a `MsgTransfer` message) instead of - or IN ADDITION
 * TO - the SDK transaction-level `TxBody.memo`.
 *
 * This is deliberately an allow-list of live-verified chains, not an assumption.
 * Over-including here REJECTS routes that would broadcast fine:
 *
 * - `columbus-5` (Terra Classic): ENFORCING. Live-verified 2026-06-29.
 * - `cosmoshub-4`, `osmosis-1`: NOT enforcing. Live-verified 2026-06-01 - Keplr
 *   broadcasts ~1500B packet memos on cosmoshub-4 without error.
 * - `phoenix-1` (Terra v2): deliberately absent. A live >512B packet-memo
 *   broadcast check is still pending; adding it unverified would over-reject
 *   valid phoenix-1 routes.
 *
 * Do not add a chain here without a live broadcast check, for the same reason
 * COSMOS_MEMO_MAX_BYTES_BY_CHAIN entries want the chain's own auth params.
 */
const COSMOS_PACKET_MEMO_ENFORCING_CHAIN_IDS: ReadonlySet<string> = new Set(['columbus-5'])

/**
 * True when the chain identified by `chainId` applies its `MaxMemoCharacters`
 * cap to the inner ICS-20 packet memo as well as the outer `TxBody.memo`.
 *
 * Callers building an IBC/PFM route must measure the packet memo too on these
 * chains: a Skip PFM leg routinely carries an EMPTY top-level memo with the
 * whole payload inside the `MsgTransfer` packet memo, so a top-level-only check
 * sees 0 bytes and admits a tx the chain rejects at broadcast with sdk error
 * code 12 ("memo too long") - after the signing ceremony has been burned.
 */
export const isCosmosPacketMemoEnforcingChainId = (chainId: string): boolean =>
  COSMOS_PACKET_MEMO_ENFORCING_CHAIN_IDS.has(chainId)

/**
 * True when `memo`'s UTF-8 byte length fits within `chain`'s live
 * `MaxMemoCharacters` cap. Uses `TextEncoder` (not Node's `Buffer`) so this
 * is safe to call from the RN bridge too.
 */
export const isCosmosMemoWithinCap = (chain: CosmosChain, memo: string): boolean =>
  new TextEncoder().encode(memo).length <= getCosmosMemoMaxBytes(chain)
