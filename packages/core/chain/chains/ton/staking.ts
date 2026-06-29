import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tonAddressToBounceable } from './address'

/**
 * Public TonAPI host. The staking endpoints (`/v2/staking/*`) are served
 * exclusively by `tonapi.io` — the Vultisig `/ton` proxy fronts toncenter v3,
 * which has no staking routes — so we hit tonapi.io directly. The extension's
 * wildcard https host permission covers it.
 */
const tonApiPublicUrl = 'https://tonapi.io'

/**
 * tonapi `implementation` values that are genuine **nominator pools** — the
 * only ones the text-comment deposit/withdraw mechanism can stake into.
 * `liquidTF` (Tonstakers) mints a jetton instead and is excluded; unknown
 * implementations are treated as non-nominator (excluded).
 */
export const tonNominatorImplementations = ['whales', 'tf'] as const

export type TonNominatorImplementation = (typeof tonNominatorImplementations)[number]

export const isTonNominatorImplementation = (
  implementation: string | undefined
): implementation is TonNominatorImplementation =>
  !!implementation && (tonNominatorImplementations as readonly string[]).includes(implementation)

/**
 * The deposit/withdraw text comments a TON nominator-pool contract expects.
 * Each pool *implementation* uses a DIFFERENT word — sending the wrong one is
 * rejected on-chain (exit code 72). These are contract protocol tokens, NOT
 * user-facing UI: never translate them.
 *
 * The Whales pool repo README's "Stake" is stale and rejected by the live
 * pools; the verified on-chain word is "Deposit".
 */
const tonStakingDepositComments: Record<TonNominatorImplementation, string> = {
  tf: 'd',
  whales: 'Deposit',
}

const tonStakingWithdrawComments: Record<TonNominatorImplementation, string> = {
  tf: 'w',
  whales: 'Withdraw',
}

/** Deposit comment for a pool implementation, or `undefined` if unsupported (block the action). */
export const tonStakingDepositComment = (implementation: string | undefined): string | undefined =>
  isTonNominatorImplementation(implementation) ? tonStakingDepositComments[implementation] : undefined

/** Withdraw comment for a pool implementation, or `undefined` if unsupported (block the action). */
export const tonStakingWithdrawComment = (implementation: string | undefined): string | undefined =>
  isTonNominatorImplementation(implementation) ? tonStakingWithdrawComments[implementation] : undefined

const tonStakingComments = new Set<string>([
  ...Object.values(tonStakingDepositComments),
  ...Object.values(tonStakingWithdrawComments),
])

/**
 * Whether a memo is a nominator-pool deposit/withdraw comment (`d`/`w`/`Deposit`
 * /`Withdraw`). The signer uses this to force the transfer bounceable: a pool
 * deposit/withdraw sent non-bounceable can be absorbed (lost) by the pool
 * instead of bounced back if rejected.
 */
export const isTonStakingComment = (memo: string | undefined): boolean => !!memo && tonStakingComments.has(memo.trim())

/**
 * Processing-commission buffer (nanotons) added on top of a pool's `min_stake`
 * for the minimum acceptable deposit. Depositing exactly the minimum is
 * rejected; the pool needs ~1 TON headroom for its processing commission.
 */
export const tonStakingDepositBuffer = 1_000_000_000n

/**
 * Amount (nanotons) accompanying a withdraw message — the pool's 0.2 TON
 * withdraw fee. The pool returns the full staked balance separately; sending
 * more (e.g. 1 TON) fails.
 */
export const tonStakingWithdrawFee = 200_000_000n

/**
 * Conservative network-fee reserve (nanotons ≈ 0.05 TON) held back from the
 * spendable balance when sizing a stake deposit or checking the unstake fee is
 * affordable. Larger than the bare base fee because the text-comment cell adds
 * compute; matches the iOS reserve.
 */
export const tonStakingFeeReserve = 50_000_000n

type RawTonStakingPoolEntry = {
  address: string
  name: string
  apy: number
  min_stake: number
  verified: boolean
  current_nominators?: number
  max_nominators?: number
  implementation?: string
  cycle_end?: number
}

/**
 * A staking-pool list entry. `address` is the bounceable user-friendly (`EQ…`)
 * pool contract address (normalized from the raw `0:` API form), `apy` is a
 * percentage (e.g. `13.27` = 13.27%), and `minStake` is in nanotons.
 */
export type TonStakingPool = {
  address: string
  name: string
  apy: number
  minStake: bigint
  verified: boolean
  currentNominators?: number
  maxNominators?: number
  implementation?: string
  cycleEnd?: number
}

const mapPoolEntry = (entry: RawTonStakingPoolEntry): TonStakingPool => ({
  // Normalize to the bounceable `EQ…` form at the boundary so no caller can
  // build a staking transfer to a raw/non-bounceable destination (which the
  // pool would absorb instead of bouncing back on rejection).
  address: tonAddressToBounceable(entry.address),
  name: entry.name,
  apy: entry.apy,
  minStake: BigInt(Math.trunc(entry.min_stake)),
  verified: entry.verified,
  currentNominators: entry.current_nominators,
  maxNominators: entry.max_nominators,
  implementation: entry.implementation,
  cycleEnd: entry.cycle_end,
})

/** Whether a pool has room for another nominator (pools at capacity reject new stakes). */
export const tonPoolHasCapacity = (pool: TonStakingPool): boolean => {
  const { currentNominators, maxNominators } = pool
  if (currentNominators === undefined || maxNominators === undefined || maxNominators <= 0) {
    return true
  }
  return currentNominators < maxNominators
}

/**
 * Whether a pool is a verified nominator pool with capacity — i.e. one the
 * picker should surface and a stake can succeed into.
 */
export const isStakeableTonPool = (pool: TonStakingPool): boolean =>
  pool.verified && isTonNominatorImplementation(pool.implementation) && tonPoolHasCapacity(pool)

/**
 * Fetches all verified TON staking pools from tonapi (`/v2/staking/pools`).
 * Includes every implementation; callers filter to stakeable nominator pools
 * via `isStakeableTonPool`.
 */
export const getTonStakingPools = async (): Promise<TonStakingPool[]> => {
  const url = `${tonApiPublicUrl}/v2/staking/pools?include_unverified=false`
  const { pools } = await queryUrl<{ pools: RawTonStakingPoolEntry[] }>(url)

  return pools.map(mapPoolEntry)
}

type RawTonStakingPoolInfo = {
  address?: string
  name?: string
  apy?: number
  min_stake?: number
  implementation?: string
  cycle_end?: number
}

/**
 * Computed info for a single pool (`/v2/staking/pool/{address}`). All fields
 * are optional so a partial/changed response degrades gracefully. `apy` is a
 * percentage; `cycleEnd` is the Unix second the current validation cycle ends.
 */
export type TonStakingPoolInfo = {
  address?: string
  name?: string
  apy?: number
  minStake?: bigint
  implementation?: string
  cycleEnd?: number
}

/** Fetches computed pool metadata (name, APY, implementation, cycle end). */
export const getTonStakingPoolInfo = async (poolAddress: string): Promise<TonStakingPoolInfo | undefined> => {
  const url = `${tonApiPublicUrl}/v2/staking/pool/${encodeURIComponent(poolAddress)}`
  const { pool } = await queryUrl<{ pool?: RawTonStakingPoolInfo }>(url)
  if (!pool) return undefined

  return {
    address: pool.address ? tonAddressToBounceable(pool.address) : undefined,
    name: pool.name,
    apy: pool.apy,
    minStake: pool.min_stake !== undefined ? BigInt(Math.trunc(pool.min_stake)) : undefined,
    implementation: pool.implementation,
    cycleEnd: pool.cycle_end,
  }
}

type RawTonNominatorPosition = {
  pool: string
  amount: number
  pending_deposit: number
  pending_withdraw: number
  ready_withdraw: number
}

/**
 * An account's position in a nominator pool. All amounts are nanotons. `amount`
 * is the active stake; `pendingDeposit` is a just-placed stake awaiting the
 * next validation cycle; `pendingWithdraw`/`readyWithdraw` indicate an
 * in-progress withdrawal (funds locked until the cycle ends). `pool` is the
 * bounceable user-friendly (`EQ…`) pool address (normalized from raw `0:`).
 */
export type TonNominatorPosition = {
  pool: string
  amount: bigint
  pendingDeposit: bigint
  pendingWithdraw: bigint
  readyWithdraw: bigint
}

/**
 * Fetches an account's nominator-pool positions
 * (`/v2/staking/nominator/{accountId}/pools`) — the authoritative source for
 * staked positions. `accountId` accepts the user-friendly wallet address.
 */
export const getTonNominatorPools = async (accountId: string): Promise<TonNominatorPosition[]> => {
  const url = `${tonApiPublicUrl}/v2/staking/nominator/${encodeURIComponent(accountId)}/pools`
  const { pools } = await queryUrl<{ pools: RawTonNominatorPosition[] }>(url)

  return pools.map(position => ({
    pool: tonAddressToBounceable(position.pool),
    amount: BigInt(Math.trunc(position.amount)),
    pendingDeposit: BigInt(Math.trunc(position.pending_deposit)),
    pendingWithdraw: BigInt(Math.trunc(position.pending_withdraw)),
    readyWithdraw: BigInt(Math.trunc(position.ready_withdraw)),
  }))
}
