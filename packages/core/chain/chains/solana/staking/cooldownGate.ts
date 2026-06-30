import { isDeactivationSentinel, SolanaStakeAccount } from './models/stakeAccount'

/**
 * Gates a stake-account withdraw on the deactivation cooldown. After a
 * deactivate, the stake cools down for ~1 epoch: the lamports become
 * withdrawable only once the network epoch has advanced PAST the account's
 * `deactivationEpoch`. Evaluating this before a withdraw keysign avoids
 * surprising the user with a transaction the Stake program would reject.
 *
 * Port of iOS `SolanaEpochCooldownGate`.
 */
export type SolanaEpochCooldownState = { status: 'available' } | { status: 'blocked'; unlocksAtEpoch: bigint }

/**
 * Evaluates whether `account`'s deactivated stake can be withdrawn at
 * `currentEpoch`. Pure function over the parsed delegation + the live epoch.
 *
 * - A non-deactivating account (sentinel `deactivationEpoch`) is `available` —
 *   there is nothing cooling down.
 * - A deactivating account unlocks once the network advances past its
 *   deactivation epoch, i.e. at `deactivationEpoch + 1`.
 */
export const evaluateCooldown = (account: SolanaStakeAccount, currentEpoch: bigint): SolanaEpochCooldownState => {
  const { delegation } = account
  if (!delegation) {
    return { status: 'available' }
  }
  if (isDeactivationSentinel(delegation)) {
    return { status: 'available' }
  }
  if (currentEpoch > delegation.deactivationEpoch) {
    return { status: 'available' }
  }
  // `deactivationEpoch` is < sentinel here, so +1 is safe.
  return { status: 'blocked', unlocksAtEpoch: delegation.deactivationEpoch + 1n }
}

/**
 * Approximate mainnet epoch length in days. Informational copy only — the
 * authoritative withdraw gate is `evaluateCooldown`, which uses the live epoch.
 */
export const approximateDaysPerEpoch = 2

/** Approximate calendar days for `epochs` epochs of cooldown. */
export const approximateCooldownDays = (epochs: number): number => Math.max(0, epochs) * approximateDaysPerEpoch
