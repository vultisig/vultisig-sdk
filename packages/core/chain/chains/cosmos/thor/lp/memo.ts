import { assertValidPoolId } from './pools'

export type AddLpMemoInput = {
  /** Canonical pool id, e.g. `BTC.BTC` or `ETH.USDC-0X...`. */
  pool: string
  /**
   * Paired L1 address. When set, THORChain registers the deposit with a
   * counterpart address on the other side of the pool. The paired address
   * is the vault's address on the OTHER chain relative to the side being
   * deposited:
   *
   *   - For a RUNE-side add (depositing RUNE on THORChain), this is the
   *     vault's L1 address on the pool's asset chain (e.g., BTC.BTC → the
   *     vault's BTC address).
   *   - For an asset-side add (depositing L1 asset), this is the vault's
   *     THORChain address (`thor1...`).
   *
   * Matches the default behavior of vultisig-ios and vultisig-windows
   * (the extension), which always auto-populate the paired address from
   * the vault. Leave omitted for a pure asymmetric deposit with no
   * paired-address registration.
   */
  pairedAddress?: string
}

/**
 * Build a THORChain liquidity-pool add memo.
 *
 * Format: `+:POOL` (pure asym, no paired address) or
 *         `+:POOL:PAIRED_ADDR` (when paired address is provided)
 *
 * Matches vultisig-ios `AddLPMemoData.memo` and
 * vultisig-windows `memoGenerator` `add_thor_lp` output exactly — no
 * affiliate suffix. The THORChain memo spec allows an affiliate via
 * `+:POOL::AFFILIATE:BPS` but neither Vultisig native client ships it;
 * we match the native behavior for wire-level consistency.
 */
export const addLpMemo = ({
  pool,
  pairedAddress,
}: AddLpMemoInput): string => {
  assertValidPoolId(pool)
  if (pairedAddress && pairedAddress.length > 0) {
    return `+:${pool}:${pairedAddress}`
  }
  return `+:${pool}`
}

export type RemoveLpMemoInput = {
  pool: string
  /** Withdraw fraction in basis points: 1..10000 (10000 = 100%). */
  basisPoints: number
  /**
   * Optional asymmetric-withdraw target. When set, THORChain sends the
   * withdrawn value out to this side only (e.g., `withdrawToAsset: "BTC"`
   * forces all output to BTC). When omitted, the protocol returns both
   * sides proportionally for symmetric positions, or to the same side for
   * asymmetric positions.
   *
   * Only the short asset ticker is used on the wire (e.g., `BTC`, not
   * `BTC.BTC`). Pass the pool's ASSET section, not the full pool id.
   */
  withdrawToAsset?: string
}

/**
 * Build a THORChain liquidity-pool remove memo.
 *
 * Format: `-:POOL:BPS` or `-:POOL:BPS:ASSET` when asym-withdraw target set.
 *
 * Withdraws do not include an affiliate suffix per the THORChain memo spec.
 * THORChain enforces a ~1 hour window (`LIQUIDITYLOCKUPBLOCKS`, currently
 * 600 on mainnet) after the most recent add before broadcasts process cleanly.
 */
export const removeLpMemo = ({
  pool,
  basisPoints,
  withdrawToAsset,
}: RemoveLpMemoInput): string => {
  assertValidPoolId(pool)
  if (
    !Number.isInteger(basisPoints) ||
    basisPoints < 1 ||
    basisPoints > 10000
  ) {
    throw new Error(
      `removeLpMemo: basisPoints must be an integer in [1, 10000], got ${basisPoints}`
    )
  }
  if (withdrawToAsset && withdrawToAsset.length > 0) {
    return `-:${pool}:${basisPoints}:${withdrawToAsset}`
  }
  return `-:${pool}:${basisPoints}`
}
