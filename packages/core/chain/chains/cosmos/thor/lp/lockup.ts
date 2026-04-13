import type { ThorchainLpPosition } from './types'
import { getThorchainMimir } from './validation'

/**
 * THORChain target block time in seconds. The chain runs on CometBFT /
 * Tendermint with a 6-second block target. Mainnet averages are stable
 * enough that we treat this as a constant — for lockup countdown UIs
 * that's plenty of precision.
 */
export const THORCHAIN_BLOCK_TIME_SECONDS = 6

/**
 * Read the current `LIQUIDITYLOCKUPBLOCKS` mimir value from thornode and
 * convert to seconds.
 *
 * Mainnet value as of 2025-04: 600 blocks = 3600 seconds = 1 hour.
 *
 * Note: per the THORChain FAQ ("no lockup period") the mimir value exists
 * but the protocol does not operationally restrict users from withdrawing.
 * Treat this as a UX hint, not a correctness requirement. The broadcast-
 * time error is the real backstop if a withdraw hits too early.
 */
export const getThorchainLpLockupSeconds = async (): Promise<number> => {
  const mimir = await getThorchainMimir()
  const blocks = mimir['LIQUIDITYLOCKUPBLOCKS']
  if (typeof blocks !== 'number' || !Number.isFinite(blocks) || blocks < 0) {
    throw new Error(
      `getThorchainLpLockupSeconds: mimir did not include a valid LIQUIDITYLOCKUPBLOCKS value`
    )
  }
  return blocks * THORCHAIN_BLOCK_TIME_SECONDS
}

export type LpWithdrawReadiness = {
  isWithdrawable: boolean
  /**
   * Unix seconds (UTC) at which the withdraw window opens. Equal to
   * `dateLastAdded + lockupSeconds`. In the past when `isWithdrawable`.
   */
  unlockAtUnix: number
  /**
   * Seconds remaining until `unlockAtUnix`. Zero when already withdrawable.
   */
  remainingSeconds: number
}

/**
 * Compute whether a position is currently past its lockup window.
 *
 * `position.dateLastAdded` is a unix-seconds timestamp string from
 * Midgard. `lockupSeconds` is the current mimir-driven window from
 * `getThorchainLpLockupSeconds()` — the caller can pass it in if they
 * already have it (to avoid an extra mimir round-trip) or omit it and
 * let this helper fetch it.
 */
export const getLpWithdrawReadiness = async ({
  position,
  lockupSeconds: providedLockupSeconds,
  nowUnix = Math.floor(Date.now() / 1000),
}: {
  position: Pick<ThorchainLpPosition, 'dateLastAdded'>
  lockupSeconds?: number
  nowUnix?: number
}): Promise<LpWithdrawReadiness> => {
  const lockupSeconds =
    providedLockupSeconds ?? (await getThorchainLpLockupSeconds())
  const lastAdded = Number(position.dateLastAdded)
  if (!Number.isFinite(lastAdded) || lastAdded <= 0) {
    // No valid last-add timestamp — assume withdrawable (fresh / unknown).
    return {
      isWithdrawable: true,
      unlockAtUnix: 0,
      remainingSeconds: 0,
    }
  }
  const unlockAtUnix = lastAdded + lockupSeconds
  const remainingSeconds = Math.max(unlockAtUnix - nowUnix, 0)
  return {
    isWithdrawable: remainingSeconds === 0,
    unlockAtUnix,
    remainingSeconds,
  }
}
