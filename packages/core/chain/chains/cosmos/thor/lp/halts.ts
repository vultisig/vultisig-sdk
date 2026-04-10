import { getThorchainInboundAddress } from '../getThorchainInboundAddress'

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
