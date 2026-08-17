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
 * Per-chain caps on the ICS-20 **packet** memo (`MsgTransfer.memo`) - a
 * structurally different field from the outer `TxBody.memo` capped by
 * {@link getCosmosMemoMaxBytesByChainId}, and one that legitimately carries far
 * more data (PFM / forward payloads).
 *
 * MEASURED EVIDENCE (152 real columbus-5 Skip envelopes, 2026-05-30 ->
 * 2026-07-18):
 *   80 successes: packet memo <= 1001 bytes
 *   72 failures:  packet memo >= 1122 bytes
 * Perfectly separated, so the true cap is bracketed in (1001, 1122]; 1024 is
 * the round value inside that bracket. Every one of those 152 envelopes has an
 * EMPTY outer memo - the payload lives entirely in the packet memo for
 * IBC-source legs - which is exactly why the outer-memo check alone never sees
 * the overflow.
 *
 * DO NOT default this table to 256 or reuse `getCosmosMemoMaxBytesByChainId`
 * for packet memos. The 80 WORKING USTC<->LUNC routes carry packet memos of
 * 698-1001 bytes on columbus-5 itself, so a 256-byte packet cap would reject
 * every one of those healthy routes. Chains with no explicit entry default to a
 * permissive ibc-go-scale ceiling instead, because most do not cap this field
 * tightly and guessing tight here silently blocks working corridors.
 */
const COSMOS_PACKET_MEMO_MAX_BYTES_BY_CHAIN_ID: Readonly<Record<string, number>> = {
  'columbus-5': 1024,
}

/** Permissive ibc-go-scale ceiling for chains with no measured packet-memo cap. */
export const COSMOS_PACKET_MEMO_DEFAULT_MAX_BYTES = 32768

/**
 * The byte cap for a chain's ICS-20 packet memo, keyed by live chain-id.
 *
 * Deliberately NOT the outer-memo cap: a packet memo that exceeds this is
 * rejected at broadcast, but one that merely exceeds the *outer* cap is fine,
 * and conflating them rejects healthy routes. Check both fields, each against
 * its own cap.
 */
export const getCosmosPacketMemoMaxBytesByChainId = (chainId: string): number =>
  COSMOS_PACKET_MEMO_MAX_BYTES_BY_CHAIN_ID[chainId] ?? COSMOS_PACKET_MEMO_DEFAULT_MAX_BYTES

/**
 * True when `memo`'s UTF-8 byte length fits within `chain`'s live
 * `MaxMemoCharacters` cap. Uses `TextEncoder` (not Node's `Buffer`) so this
 * is safe to call from the RN bridge too.
 */
export const isCosmosMemoWithinCap = (chain: CosmosChain, memo: string): boolean =>
  new TextEncoder().encode(memo).length <= getCosmosMemoMaxBytes(chain)
