import {
  VULTISIG_AFFILIATE_LP_BPS,
  VULTISIG_AFFILIATE_NAME,
} from './affiliate'
import { assertValidPoolId } from './pools'

export type AddLpMemoInput = {
  /** Canonical pool id, e.g. `BTC.BTC` or `ETH.USDC-0X...`. */
  pool: string
  /**
   * Paired L1 address. Omit for asymmetric adds (the v1 path). When set,
   * THORChain will hold the deposit pending and pair it with a matching
   * deposit from the other side, producing a symmetric position.
   */
  pairedAddress?: string
  /** Affiliate THORName. Defaults to `VULTISIG_AFFILIATE_NAME`. */
  affiliate?: string
  /** Affiliate fee in basis points. Defaults to `VULTISIG_AFFILIATE_LP_BPS`. */
  affiliateBps?: number
}

/**
 * Build a THORChain liquidity-pool add memo.
 *
 * Format: `+:POOL:PAIRED_ADDR:AFFILIATE:BPS`
 *
 * For an asymmetric RUNE-side add with the default Vultisig affiliate at
 * 0 bps the memo looks like `+:BTC.BTC::vi:0`. The empty paired-address slot
 * is intentional — that is what tells THORChain to register the position as
 * asymmetric.
 */
export const addLpMemo = (input: AddLpMemoInput): string => {
  assertValidPoolId(input.pool)
  const affiliate = input.affiliate ?? VULTISIG_AFFILIATE_NAME
  const bps = input.affiliateBps ?? VULTISIG_AFFILIATE_LP_BPS
  const paired = input.pairedAddress ?? ''
  return `+:${input.pool}:${paired}:${affiliate}:${bps}`
}

export type RemoveLpMemoInput = {
  pool: string
  /** Withdraw fraction in basis points: 1..10000 (10000 = 100%). */
  basisPoints: number
}

/**
 * Build a THORChain liquidity-pool remove memo.
 *
 * Format: `-:POOL:BPS`
 *
 * Withdraws do not include an affiliate suffix per the THORChain memo spec.
 * THORChain enforces a 1-hour lockup after the most recent add — broadcasting
 * a withdraw inside that window will fail at the chain level.
 */
export const removeLpMemo = ({
  pool,
  basisPoints,
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
  return `-:${pool}:${basisPoints}`
}
