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
 * Chains whose gov-set `MaxMemoCharacters` differs from the cosmos-sdk default.
 * A chain absent here uses `COSMOS_MEMO_DEFAULT_MAX_BYTES` (256), not "no cap" -
 * that default closes the fail-open gap of an unmapped chain never getting
 * checked, which fails on virtually every cosmos chain in practice.
 */
const COSMOS_MEMO_MAX_BYTES_OVERRIDES: Partial<Record<CosmosChain, number>> = {
  // Terra v2 (phoenix-1): live-verified 512 (2026-06-22, /cosmos/auth params) -
  // Terra raised MaxMemoCharacters above the sdk default.
  [CosmosChain.Terra]: 512,
  // Cosmos Hub (cosmoshub-4): live-verified 512 (2026-06-22, /cosmos/auth params) -
  // gov-raised above the sdk default.
  [CosmosChain.Cosmos]: 512,
}

/**
 * The `x/auth.MaxMemoCharacters` byte cap for a cosmos chain's outer
 * `TxBody.memo` field. A tx whose memo exceeds this is rejected at broadcast
 * with sdk error code 12 ("memo too long") - AFTER the user has already signed,
 * burning the signing ceremony for nothing. Check this before building any
 * cosmos tx with a caller-supplied memo.
 */
export const getCosmosMemoMaxBytes = (chain: CosmosChain): number =>
  COSMOS_MEMO_MAX_BYTES_OVERRIDES[chain] ?? COSMOS_MEMO_DEFAULT_MAX_BYTES

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
 * True when `memo`'s UTF-8 byte length fits within `chain`'s live
 * `MaxMemoCharacters` cap. Uses `TextEncoder` (not Node's `Buffer`) so this
 * is safe to call from the RN bridge too.
 */
export const isCosmosMemoWithinCap = (chain: CosmosChain, memo: string): boolean =>
  new TextEncoder().encode(memo).length <= getCosmosMemoMaxBytes(chain)
