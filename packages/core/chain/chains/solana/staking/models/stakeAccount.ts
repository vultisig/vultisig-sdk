import { solanaStakingConfig } from '../config'

/**
 * Parsed Solana stake account — the read-side model the staking UI binds to
 * (delegation amount, validator, activation state, withdraw authority). One
 * stake account delegates to exactly one validator; a wallet can hold N.
 *
 * Decoded from a `getAccountInfo` / `getProgramAccounts` `jsonParsed` row
 * (`value.data.parsed.info.{meta,stake}`). The on-chain numbers
 * (`activationEpoch`, `deactivationEpoch`, `stake`, `rentExemptReserve`) are
 * serialized as decimal STRINGS in jsonParsed — they're u64 and exceed JSON's
 * safe-integer range — so they are converted to `bigint` here.
 *
 * Port of iOS `SolanaStakeAccount`.
 */

/**
 * Activation lifecycle of a stake delegation, derived from the account's
 * `activationEpoch` / `deactivationEpoch` relative to the current epoch.
 * Solana stake activates at the next epoch boundary and cools down ~1 epoch
 * after a deactivate before the funds can be withdrawn.
 */
export type SolanaStakeActivationState = 'activating' | 'active' | 'deactivating' | 'inactive'

export type SolanaStakeDelegation = {
  /** Vote account this stake is delegated to. */
  votePubkey: string
  /** Epoch the delegation began activating. */
  activationEpoch: bigint
  /**
   * Epoch the delegation began deactivating, or `epochSentinel` (`u64::MAX`)
   * while active (the Stake program's "not deactivating" sentinel).
   */
  deactivationEpoch: bigint
  /** Delegated lamports. */
  stake: bigint
}

export type SolanaStakeAccount = {
  /** Stake account address (its own pubkey, not the owner's). */
  pubkey: string
  /**
   * The account's total lamports (delegated stake + rent reserve + any
   * undelegated lamports).
   */
  lamports: bigint
  /**
   * Rent-exempt reserve held by the account — not part of the delegated /
   * withdrawable stake.
   */
  rentExemptReserve: bigint
  /** Authority allowed to delegate / deactivate the stake. */
  staker: string
  /** Authority allowed to withdraw the stake. */
  withdrawer: string
  /**
   * The delegation, or `undefined` for an initialized-but-undelegated account
   * (`parsed.type == "initialized"`, no `stake.delegation`).
   */
  delegation?: SolanaStakeDelegation
}

/** `true` when no deactivation has been scheduled on the delegation. */
export const isDeactivationSentinel = (delegation: SolanaStakeDelegation): boolean =>
  delegation.deactivationEpoch === solanaStakingConfig.epochSentinel

/**
 * Derives the lifecycle state from the current epoch. Pure so the cooldown gate
 * and the UI share one definition.
 *
 * - activating: delegation began this epoch and is not deactivating.
 * - deactivating: a deactivation was scheduled and the current epoch has not
 *   yet passed it.
 * - active: delegated in a prior epoch and not deactivating.
 * - inactive: no delegation, or the deactivation epoch has passed.
 */
export const stakeActivationState = (account: SolanaStakeAccount, currentEpoch: bigint): SolanaStakeActivationState => {
  const { delegation } = account
  if (!delegation) {
    return 'inactive'
  }

  if (!isDeactivationSentinel(delegation)) {
    // A deactivation is scheduled. Still cooling down until the current epoch
    // passes the deactivation epoch; inactive afterwards.
    return currentEpoch <= delegation.deactivationEpoch ? 'deactivating' : 'inactive'
  }

  // No deactivation scheduled — activating in its first epoch, active after.
  return currentEpoch <= delegation.activationEpoch ? 'activating' : 'active'
}

// MARK: - jsonParsed wire decoding

/**
 * Mirrors the `jsonParsed` Stake-program account `info` shape. u64 fields arrive
 * as decimal strings (or numbers); `toBigInt` coerces both.
 */
type ParsedStakeInfo = {
  meta?: {
    rentExemptReserve?: string | number
    authorized?: { staker?: string; withdrawer?: string }
  }
  stake?: {
    delegation?: {
      voter?: string
      stake?: string | number
      activationEpoch?: string | number
      deactivationEpoch?: string | number
    }
  }
}

const toBigInt = (value: string | number | undefined): bigint | undefined => {
  if (value === undefined) {
    return undefined
  }
  try {
    return BigInt(typeof value === 'number' ? Math.trunc(value) : value)
  } catch {
    return undefined
  }
}

/**
 * Builds the model from a decoded jsonParsed Stake-program account. Returns
 * `undefined` when the account is not a parsed stake account (e.g. a non-stake
 * program account or a base64/dataSliced row with no `parsed` tree).
 */
export const parseStakeAccount = ({
  pubkey,
  lamports,
  parsedInfo,
}: {
  pubkey: string
  lamports: bigint
  parsedInfo: ParsedStakeInfo | undefined
}): SolanaStakeAccount | undefined => {
  // Reject partially-malformed payloads rather than coercing them into
  // fabricated zero/empty values — a bogus `0n` stake or empty authority would
  // surface downstream as wrong balances or a falsely inactive/available state.
  const meta = parsedInfo?.meta
  if (!meta?.authorized?.staker || !meta.authorized.withdrawer) {
    return undefined
  }

  const rentExemptReserve = toBigInt(meta.rentExemptReserve)
  if (rentExemptReserve === undefined) {
    return undefined
  }

  const delegationInfo = parsedInfo?.stake?.delegation
  let delegation: SolanaStakeDelegation | undefined
  if (delegationInfo) {
    // A delegation object with no `voter` is a malformed row, not an
    // undelegated account — reject it rather than fabricating "inactive".
    if (!delegationInfo.voter) {
      return undefined
    }
    const activationEpoch = toBigInt(delegationInfo.activationEpoch)
    const deactivationEpoch = toBigInt(delegationInfo.deactivationEpoch)
    const stake = toBigInt(delegationInfo.stake)
    if (activationEpoch === undefined || deactivationEpoch === undefined || stake === undefined) {
      return undefined
    }
    delegation = {
      votePubkey: delegationInfo.voter,
      activationEpoch,
      deactivationEpoch,
      stake,
    }
  }

  return {
    pubkey,
    lamports,
    rentExemptReserve,
    staker: meta.authorized.staker,
    withdrawer: meta.authorized.withdrawer,
    delegation,
  }
}
