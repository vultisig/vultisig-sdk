/**
 * Carries the Solana staking-operation intent from the build-keysign step into
 * the byte-parity unsigned-tx builder (wallet-core's Solana stake proto:
 * delegate / deactivate / withdraw / move-stake).
 *
 * A move-stake (redelegate A → B) is a guided, multi-transaction, cross-epoch
 * flow — Solana has no native redelegate. It decomposes into discrete sub-steps
 * mapped onto existing wallet-core primitives so the cross-device byte-parity
 * guarantee holds:
 *   - `moveStakeDeactivate` → DeactivateStake on the moved account (byte-
 *     identical to a plain unstake); begins the ~1-epoch cooldown.
 *   - `moveStakeRedelegate` → DelegateStake the now-inactive moved account to
 *     validator B, with the existing `stakeAccount` set EXPLICITLY (a fresh
 *     delegate omits it so wallet-core derives a new account).
 *   - The Stake-program `Split` instruction (a partial move) is not exposed by
 *     wallet-core's high-level Solana proto, so only whole-account moves are
 *     supported.
 *
 * Port of iOS `SolanaStakingPayload`.
 */
export type SolanaStakingPayload =
  | { op: 'delegate'; votePubkey: string; lamports: bigint }
  | { op: 'unstake'; stakeAccount: string }
  | { op: 'withdraw'; stakeAccount: string; lamports: bigint }
  | { op: 'moveStakeDeactivate'; stakeAccount: string }
  | {
      op: 'moveStakeRedelegate'
      stakeAccount: string
      votePubkey: string
      lamports: bigint
    }

/** Discriminant union of every Solana staking op type. */
export const solanaStakingOps = [
  'delegate',
  'unstake',
  'withdraw',
  'moveStakeDeactivate',
  'moveStakeRedelegate',
] as const

export type SolanaStakingOp = (typeof solanaStakingOps)[number]
