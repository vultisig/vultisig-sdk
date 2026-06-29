/**
 * Constants for Solana native staking (Stake program) reads.
 *
 * The Stake-program account layout and the staker-authority memcmp offset are
 * protocol facts, not per-chain config, so this is a single flat constant set.
 *
 * The min-delegation RPC (`getStakeMinimumDelegation`) is blocked by the
 * Vultisig proxy. The 1 SOL program minimum delegation is active on mainnet and
 * is enforced by the Stake program — a delegation below it reverts with
 * `StakeError.InsufficientDelegation`. Since the RPC is blocked, the delegation
 * floor uses the documented `minDelegationFloorLamports` constant below plus the
 * live rent-exempt reserve (active stake = funding − rent, so the funding floor
 * is 1 SOL + rent).
 *
 * Port of iOS `SolanaStakingConfig`.
 */
export const solanaStakingConfig = {
  /**
   * The on-chain Stake program. Every stake account is owned by this program;
   * it is also the `programId` argument to the stake-filtered
   * `getProgramAccounts` scan.
   */
  stakeProgramId: 'Stake11111111111111111111111111111111111111',

  /**
   * Byte size of a fully-initialized stake account (`StakeStateV2`). The
   * `getProgramAccounts` scan filters on `dataSize: 200` to exclude
   * uninitialized / rewards-pool accounts before the memcmp narrows to the
   * owner's accounts.
   */
  stakeStateSize: 200,

  /**
   * Offset of the staker authority pubkey inside the stake-account data, used
   * as the `memcmp` offset to fetch only a given owner's stake accounts.
   * Layout: 4-byte state enum discriminant + 8-byte `rentExemptReserve` = 12
   * bytes precede `Meta.authorized.staker`.
   */
  stakerMemcmpOffset: 12,

  /**
   * Offset of the delegation `voter` (vote account) pubkey inside the
   * stake-account data. Available for vote-account-scoped scans; the
   * owner-scoped read uses `stakerMemcmpOffset`.
   */
  voterMemcmpOffset: 124,

  /**
   * Documented substitute for the blocked min-delegation RPC. 1 SOL in
   * lamports — the historical program minimum. Used together with the live
   * rent-exempt reserve as the delegation floor.
   */
  minDelegationFloorLamports: 1_000_000_000n,

  /** Lamports per SOL (9 decimals). Shared by the staking read/format layer. */
  lamportsPerSol: 1_000_000_000n,

  /**
   * Rent-exempt reserve for a 200-byte stake account (`StakeStateV2`), in
   * lamports. Deterministic from the rent rate + account size, so it serves as
   * the pre-load default before the live `getMinimumBalanceForRentExemption`
   * read returns.
   */
  rentExemptReserveLamports: 2_282_880n,

  /**
   * Mainnet schedule: 432,000 slots per epoch (~2 days). Informational — the
   * live value is read from `getEpochInfo.slotsInEpoch`; this is the documented
   * fallback for activation/cooldown copy.
   */
  slotsPerEpoch: 432_000n,

  /**
   * `u64::MAX` sentinel the Stake program writes into `deactivationEpoch` while
   * a delegation is active (not deactivating). Parsed stake accounts carry this
   * verbatim; the activation-state derivation treats it as "no deactivation
   * scheduled".
   */
  epochSentinel: 18_446_744_073_709_551_615n,
} as const

/** SOL decimals — used by the staking format layer. */
export const solDecimals = 9
