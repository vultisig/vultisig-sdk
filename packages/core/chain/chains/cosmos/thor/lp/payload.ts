import {
  VULTISIG_AFFILIATE_LP_BPS,
  VULTISIG_AFFILIATE_NAME,
} from './affiliate'
import { addLpMemo, removeLpMemo } from './memo'

/**
 * Flat unsigned-transaction payload for an asymmetric RUNE-side LP add.
 *
 * Shape stays single-nesting-level on purpose: this object is what flows
 * through the agent backend's SSE `tx_ready` event, and the audit
 * (2026-04-09) flagged tool result flattening as a known wire-level hazard
 * for nested fields. Every consumer (MCP tool result, backend SSE emit, app
 * `parseServerTx`) reads the same flat keys.
 */
export type ThorchainLpAddPayload = {
  kind: 'thorchain_lp_add'
  chain: 'THORChain'
  denom: 'rune'
  /** RUNE base units; 1 RUNE = 100000000 (8 decimals). */
  amount: string
  /** Pre-built memo via `addLpMemo`. */
  memo: string
  /** Canonical pool id, denormalized for display. */
  pool: string
  /** Affiliate THORName, denormalized for display. */
  affiliate: string
  /** Affiliate fee in basis points, denormalized for display. */
  affiliateBps: number
}

export type ThorchainLpRemovePayload = {
  kind: 'thorchain_lp_remove'
  chain: 'THORChain'
  denom: 'rune'
  /** Dust amount in RUNE base units. The withdraw fraction lives in the memo. */
  amount: string
  /** Pre-built memo via `removeLpMemo`. */
  memo: string
  pool: string
  basisPoints: number
}

/**
 * Dust amount used for LP removes.
 *
 * Reference: vultisig-windows/core/ui/vault/deposit/keysignPayload/build.ts
 * sends 0.02 RUNE on LP remove transactions — the on-chain amount is just
 * dust to make the cosmos message valid; the actual withdraw fraction lives
 * inside the memo (`-:POOL:BPS`).
 */
const LP_REMOVE_DUST_RUNE_BASE_UNITS = '2000000'

const isPositiveBaseUnitString = (value: string): boolean =>
  /^\d+$/.test(value) && BigInt(value) > 0n

export type BuildThorchainLpAddPayloadInput = {
  pool: string
  amountRuneBaseUnits: string
}

export const buildThorchainLpAddPayload = ({
  pool,
  amountRuneBaseUnits,
}: BuildThorchainLpAddPayloadInput): ThorchainLpAddPayload => {
  if (!isPositiveBaseUnitString(amountRuneBaseUnits)) {
    throw new Error(
      `buildThorchainLpAddPayload: amountRuneBaseUnits must be a positive integer string, got ${amountRuneBaseUnits}`
    )
  }
  return {
    kind: 'thorchain_lp_add',
    chain: 'THORChain',
    denom: 'rune',
    amount: amountRuneBaseUnits,
    memo: addLpMemo({ pool }),
    pool,
    affiliate: VULTISIG_AFFILIATE_NAME,
    affiliateBps: VULTISIG_AFFILIATE_LP_BPS,
  }
}

export type BuildThorchainLpRemovePayloadInput = {
  pool: string
  basisPoints: number
}

export const buildThorchainLpRemovePayload = ({
  pool,
  basisPoints,
}: BuildThorchainLpRemovePayloadInput): ThorchainLpRemovePayload => ({
  kind: 'thorchain_lp_remove',
  chain: 'THORChain',
  denom: 'rune',
  amount: LP_REMOVE_DUST_RUNE_BASE_UNITS,
  memo: removeLpMemo({ pool, basisPoints }),
  pool,
  basisPoints,
})
