import { addLpMemo, removeLpMemo } from './memo'

/**
 * Flat unsigned-transaction payload for an asymmetric RUNE-side LP add.
 *
 * Shape stays single-nesting-level on purpose: this object flows through
 * the agent backend's SSE `tx_ready` event, and the 2026-04-09 audit
 * flagged tool result flattening as a known wire-level hazard for nested
 * fields. Every consumer (MCP tool result, backend SSE emit, app
 * `parseServerTx`) reads the same flat keys.
 *
 * v2 wire format drops the `affiliate` / `affiliateBps` fields. Matches
 * vultisig-ios and vultisig-windows (the extension) — neither ships an
 * affiliate on LP memos.
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
  /**
   * Paired L1 address embedded in the memo, if any. Denormalized for
   * display so consumers don't have to re-parse the memo.
   */
  pairedAddress?: string
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
  /**
   * Asym-withdraw target asset, if any. Denormalized for display.
   */
  withdrawToAsset?: string
}

/**
 * Dust amount used for LP removes.
 *
 * Reference: vultisig-windows (the extension)
 * `core/ui/vault/deposit/keysignPayload/build.ts` uses 0.02 RUNE as the
 * dust amount on LP remove transactions — the on-chain amount is just
 * dust to make the cosmos message valid; the actual withdraw fraction
 * lives inside the memo (`-:POOL:BPS`).
 */
const LP_REMOVE_DUST_RUNE_BASE_UNITS = '2000000'

const isPositiveBaseUnitString = (value: string): boolean =>
  /^\d+$/.test(value) && BigInt(value) > 0n

export type BuildThorchainLpAddPayloadInput = {
  pool: string
  amountRuneBaseUnits: string
  /**
   * Optional paired address. When provided, embedded in the memo (matching
   * iOS / Windows-extension auto-pair behavior) and denormalized on the
   * payload for display.
   */
  pairedAddress?: string
}

export const buildThorchainLpAddPayload = ({
  pool,
  amountRuneBaseUnits,
  pairedAddress,
}: BuildThorchainLpAddPayloadInput): ThorchainLpAddPayload => {
  if (!isPositiveBaseUnitString(amountRuneBaseUnits)) {
    throw new Error(
      `buildThorchainLpAddPayload: amountRuneBaseUnits must be a positive integer string, got ${amountRuneBaseUnits}`
    )
  }
  const memo = addLpMemo({ pool, pairedAddress })
  return {
    kind: 'thorchain_lp_add',
    chain: 'THORChain',
    denom: 'rune',
    amount: amountRuneBaseUnits,
    memo,
    pool,
    ...(pairedAddress ? { pairedAddress } : {}),
  }
}

export type BuildThorchainLpRemovePayloadInput = {
  pool: string
  basisPoints: number
  /**
   * Optional asym-withdraw target. Pass the short asset ticker (e.g. `BTC`),
   * not the full pool id.
   */
  withdrawToAsset?: string
}

export const buildThorchainLpRemovePayload = ({
  pool,
  basisPoints,
  withdrawToAsset,
}: BuildThorchainLpRemovePayloadInput): ThorchainLpRemovePayload => {
  // removeLpMemo validates this too, but fail fast at the payload
  // boundary so callers see a consistent error shape with the add
  // builder (which validates amountRuneBaseUnits up-front).
  if (
    !Number.isInteger(basisPoints) ||
    basisPoints < 1 ||
    basisPoints > 10000
  ) {
    throw new Error(
      `buildThorchainLpRemovePayload: basisPoints must be an integer in [1, 10000], got ${basisPoints}`
    )
  }
  const memo = removeLpMemo({ pool, basisPoints, withdrawToAsset })
  return {
    kind: 'thorchain_lp_remove',
    chain: 'THORChain',
    denom: 'rune',
    amount: LP_REMOVE_DUST_RUNE_BASE_UNITS,
    memo,
    pool,
    basisPoints,
    ...(withdrawToAsset ? { withdrawToAsset } : {}),
  }
}
