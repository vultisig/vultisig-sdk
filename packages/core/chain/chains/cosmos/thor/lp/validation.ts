import { Chain } from '@vultisig/core-chain/Chain'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { assertValidPoolId } from './pools'

const extractPoolStatus = (raw: unknown): string | undefined => {
  if (raw && typeof raw === 'object' && 'status' in raw) {
    const status = (raw as { status: unknown }).status
    return typeof status === 'string' ? status : undefined
  }
  return undefined
}

/**
 * Build the mimir flag key THORChain uses to pause LP deposits for a
 * single pool. Format: `PAUSELPDEPOSIT-{CHAIN}-{ASSET_PLUS_CONTRACT}`.
 *
 * Examples:
 *   BTC.BTC                     → PAUSELPDEPOSIT-BTC-BTC
 *   DOGE.DOGE                   → PAUSELPDEPOSIT-DOGE-DOGE
 *   ETH.USDC-0XA0B...           → PAUSELPDEPOSIT-ETH-USDC-0XA0B...
 *
 * Note: `CHAIN.ASSET` splits on the FIRST `.`; the rest (including any
 * `-CONTRACT` suffix) is the asset portion, which is appended with a
 * single `-` separator.
 */
export const poolPauseMimirKey = (pool: string): string => {
  const dotIdx = pool.indexOf('.')
  if (dotIdx <= 0 || dotIdx >= pool.length - 1) {
    throw new Error(`poolPauseMimirKey: invalid pool id ${pool}`)
  }
  const chain = pool.slice(0, dotIdx)
  const asset = pool.slice(dotIdx + 1)
  return `PAUSELPDEPOSIT-${chain}-${asset}`
}

/**
 * Fetch the raw thornode mimir map. Returns an object with flag keys as
 * numbers. Used to check per-pool LP deposit pauses (PAUSELPDEPOSIT-*),
 * liquidity lockup (LIQUIDITYLOCKUPBLOCKS), etc.
 */
export const getThorchainMimir = async (): Promise<Record<string, number>> => {
  const url = `${cosmosRpcUrl[Chain.THORChain]}/thorchain/mimir`
  const raw = await queryUrl<unknown>(url)
  if (!raw || typeof raw !== 'object') {
    throw new Error(
      `getThorchainMimir: unexpected response shape from ${url}`
    )
  }
  // thornode /thorchain/mimir returns numeric values, but the JSON could
  // deserialize as number or numeric string depending on the upstream
  // proxy. Normalize to number, drop entries we can't coerce — downstream
  // callers do `typeof v === 'number' && v > 0` checks anyway, and a NaN
  // would silently defeat those.
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v
    } else if (typeof v === 'string' && /^-?\d+$/.test(v)) {
      out[k] = Number(v)
    }
  }
  return out
}

/**
 * Verify a THORChain pool is currently depositable. Checks TWO layers:
 *
 * 1. **Thornode pool status** — `/thorchain/pool/{asset}.status` must be
 *    `Available`. Catches staged / suspended pools.
 * 2. **Mimir per-pool pause flag** — `PAUSELPDEPOSIT-{chain}-{asset}`
 *    must not be set. Catches the case where the pool is listed as
 *    available BUT the THORChain handler rejects LP adds for it via
 *    mimir (what happened to BTC.BTC on 2026-04-10: pool.status was
 *    `Available`, deposits silently accepted into mempool, handler
 *    rejected at execution with "deposits are paused for asset
 *    (btc.btc): internal error"). Without the mimir check, the user
 *    signs a tx that is guaranteed to fail on-chain.
 *
 * Use this as the fail-fast gate before building an LP add payload.
 */
export const assertPoolDepositable = async (pool: string): Promise<void> => {
  assertValidPoolId(pool)

  // Run both checks in parallel — they hit different endpoints so there
  // is no reason to serialize them.
  const [poolRaw, mimir] = await Promise.all([
    queryUrl<unknown>(
      `${cosmosRpcUrl[Chain.THORChain]}/thorchain/pool/${encodeURIComponent(pool)}`
    ),
    getThorchainMimir(),
  ])

  // Check 1: thornode pool.status
  const status = extractPoolStatus(poolRaw)
  if (status === undefined) {
    throw new Error(
      `assertPoolDepositable: pool ${pool} response from thornode did not include a string \`status\` field`
    )
  }
  if (status !== 'Available') {
    throw new Error(
      `assertPoolDepositable: pool ${pool} status is ${status}, must be Available for LP add`
    )
  }

  // Check 2: mimir per-pool PAUSELPDEPOSIT flag
  const pauseKey = poolPauseMimirKey(pool)
  const pauseValue = mimir[pauseKey]
  if (typeof pauseValue === 'number' && pauseValue > 0) {
    throw new Error(
      `assertPoolDepositable: pool ${pool} has LP deposits paused on-chain via mimir ${pauseKey}=${pauseValue}. THORChain validators have disabled new adds for this pool; any tx would be rejected at handler execution time.`
    )
  }
}
