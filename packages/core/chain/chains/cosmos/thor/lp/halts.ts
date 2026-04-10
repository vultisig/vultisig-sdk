import { getThorchainInboundAddress } from '../getThorchainInboundAddress'
import { getThorchainMimir, poolPauseMimirKey } from './validation'

export type LpHaltStatus = {
  chain: string
  depositable: boolean
  withdrawable: boolean
  /** Human-readable reasons, empty when both flags are `true`. */
  reasons: string[]
  /** Raw flags from thornode for downstream consumers that want detail. */
  raw: {
    halted: boolean
    chain_trading_paused: boolean
    chain_lp_actions_paused: boolean
    global_trading_paused: boolean
  }
}

const buildStatus = (raw: {
  chain: string
  halted: boolean
  chain_trading_paused: boolean
  chain_lp_actions_paused: boolean
  global_trading_paused: boolean
}): LpHaltStatus => {
  const reasons: string[] = []
  if (raw.halted) reasons.push(`${raw.chain} chain is halted`)
  if (raw.global_trading_paused) reasons.push('global trading paused')
  if (raw.chain_trading_paused)
    reasons.push(`${raw.chain} chain trading paused`)
  if (raw.chain_lp_actions_paused)
    reasons.push(`${raw.chain} LP actions paused`)

  // Deposit gate: any of these block new LP adds
  const depositable =
    !raw.halted &&
    !raw.chain_lp_actions_paused &&
    !raw.chain_trading_paused &&
    !raw.global_trading_paused

  // Withdraw gate: halt + lp_actions_paused block withdraws.
  // global_trading_paused may delay but does not block withdraws at the
  // protocol level (the message is accepted; the outbound is queued).
  const withdrawable = !raw.halted && !raw.chain_lp_actions_paused

  return {
    chain: raw.chain,
    depositable,
    withdrawable,
    reasons,
    raw: {
      halted: raw.halted,
      chain_trading_paused: raw.chain_trading_paused,
      chain_lp_actions_paused: raw.chain_lp_actions_paused,
      global_trading_paused: raw.global_trading_paused,
    },
  }
}

/**
 * Look up the LP halt / pause status for every THORChain-supported chain
 * in a single thornode round-trip.
 *
 * Returns one `LpHaltStatus` per chain in `/thorchain/inbound_addresses`.
 * Useful for "which pools can I actually add to right now?" queries.
 */
export const getThorchainLpHaltStatusAll = async (): Promise<
  LpHaltStatus[]
> => {
  const addresses = await getThorchainInboundAddress()
  return addresses.map(a =>
    buildStatus({
      chain: a.chain,
      halted: a.halted,
      chain_trading_paused: a.chain_trading_paused,
      chain_lp_actions_paused: a.chain_lp_actions_paused,
      global_trading_paused: a.global_trading_paused,
    })
  )
}

/**
 * Look up the LP halt / pause status for a specific chain by its
 * THORChain-pool-prefix (e.g. `BTC`, `ETH`, `DOGE`).
 *
 * Throws when the chain is not in the inbound_addresses response. Prefer
 * `getThorchainLpHaltStatusAll` + filter if you want a nullable result.
 */
export const getThorchainLpHaltStatus = async (
  chain: string
): Promise<LpHaltStatus> => {
  const all = await getThorchainLpHaltStatusAll()
  const upper = chain.toUpperCase()
  const match = all.find(s => s.chain.toUpperCase() === upper)
  if (!match) {
    throw new Error(
      `getThorchainLpHaltStatus: chain ${chain} not found in inbound_addresses`
    )
  }
  return match
}

/**
 * Look up the per-pool LP deposit pause status from mimir.
 *
 * THORChain can pause LP deposits for a SPECIFIC pool via the mimir flag
 * `PAUSELPDEPOSIT-{chain}-{asset}` independently of the chain-level
 * `chain_lp_actions_paused` flag in `inbound_addresses`. When that flag
 * is set, `/thorchain/pool/{asset}.status` still reports `Available` and
 * new LP add transactions are silently accepted into the mempool — but
 * the THORChain handler rejects them at execution time with an internal
 * error, wasting the user's native fee.
 *
 * Use this helper (or `assertPoolDepositable` which already calls it) as
 * a pre-flight gate before building an LP add payload to catch that case.
 *
 * Returns `{ paused: false }` when the mimir flag is unset or zero.
 * Returns `{ paused: true, mimirKey, mimirValue }` when paused. Does NOT
 * throw — the caller decides whether to block, warn, or continue.
 */
export const getThorchainLpPoolPauseStatus = async (
  pool: string
): Promise<
  | { paused: false }
  | { paused: true; mimirKey: string; mimirValue: number }
> => {
  const mimir = await getThorchainMimir()
  const mimirKey = poolPauseMimirKey(pool)
  const mimirValue = mimir[mimirKey]
  if (typeof mimirValue === 'number' && mimirValue > 0) {
    return { paused: true, mimirKey, mimirValue }
  }
  return { paused: false }
}
