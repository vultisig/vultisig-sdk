import { Chain } from '@vultisig/core-chain/Chain'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { assertValidPoolId, thorchainMidgardBaseUrl } from './pools'

/**
 * Subset of a Midgard `/v2/member/{address}` pool entry. Midgard returns
 * many more fields per position — we keep just the ones the agent stack
 * surfaces in chat (units, added amounts, pending state, last-add timestamp).
 */
export type ThorchainLpPosition = {
  pool: string
  liquidityUnits: string
  runeAdded: string
  assetAdded: string
  runePending: string
  assetPending: string
  runeAddress: string
  assetAddress: string
  /** Unix seconds (Midgard returns it as a string). */
  dateLastAdded: string
  /**
   * True when either side has a non-zero pending amount. Common for
   * asymmetric adds that THORChain has not yet credited.
   */
  isPending: boolean
}

type RawMemberPool = {
  pool?: string
  liquidityUnits?: string
  runeAdded?: string
  assetAdded?: string
  runePending?: string
  assetPending?: string
  runeAddress?: string
  assetAddress?: string
  dateLastAdded?: string
}

type RawMemberResponse = {
  pools?: RawMemberPool[]
}

const isNonZero = (s: string | undefined): boolean => {
  if (!s) return false
  try {
    return BigInt(s) > 0n
  } catch {
    return false
  }
}

const normalizeMemberPool = (raw: RawMemberPool): ThorchainLpPosition => ({
  pool: raw.pool ?? '',
  liquidityUnits: raw.liquidityUnits ?? '0',
  runeAdded: raw.runeAdded ?? '0',
  assetAdded: raw.assetAdded ?? '0',
  runePending: raw.runePending ?? '0',
  assetPending: raw.assetPending ?? '0',
  runeAddress: raw.runeAddress ?? '',
  assetAddress: raw.assetAddress ?? '',
  dateLastAdded: raw.dateLastAdded ?? '0',
  isPending: isNonZero(raw.runePending) || isNonZero(raw.assetPending),
})

export type GetThorchainLpPositionInput = {
  /** bech32 thor1... address (the RUNE side of the position). */
  thorAddress: string
  /** Canonical pool id to look up. */
  pool: string
}

/**
 * Fetch a single LP position from Midgard.
 *
 * Returns `null` when:
 *   - the address has no positions at all (Midgard returns 404), or
 *   - the address has positions but none in the requested pool.
 */
/**
 * Detect a 404 from queryUrl by reading the typed `HttpResponseError.status`
 * field that `@vultisig/lib-utils` `assertFetchResponse` now throws. The
 * previous implementation string-matched the error message; that worked
 * but was brittle to wording changes. See NeoMakinG's PR #236 review note.
 */
const isMidgardNotFoundError = (err: unknown): boolean =>
  err instanceof HttpResponseError && err.status === 404

export const getThorchainLpPosition = async ({
  thorAddress,
  pool,
}: GetThorchainLpPositionInput): Promise<ThorchainLpPosition | null> => {
  assertValidPoolId(pool)
  const url = `${thorchainMidgardBaseUrl}/v2/member/${encodeURIComponent(thorAddress)}`
  let midgardNotFound = false
  let raw: RawMemberResponse = {}
  try {
    raw = await queryUrl<RawMemberResponse>(url)
  } catch (err) {
    if (isMidgardNotFoundError(err)) {
      midgardNotFound = true
    } else {
      throw err
    }
  }
  if (!midgardNotFound) {
    const pools = Array.isArray(raw.pools) ? raw.pools : []
    const found = pools.find(p => p.pool === pool)
    if (found) return normalizeMemberPool(found)
  }
  // Midgard has no record of this pool for this address. THORChain
  // asymmetric adds land as `pending_rune` / `pending_asset` on thornode
  // and stay off Midgard until the counter-side materializes the LP (or a
  // pending-timeout flips the state). A pending-only position is still
  // fully withdrawable via `-:POOL:BPS` — the handler refunds the pending
  // side. Falling back to thornode here so the LLM sees the position and
  // doesn't wrongly tell the user "nothing to withdraw".
  return getThorchainLpPositionFromThornode({ thorAddress, pool })
}

type RawThornodeLp = {
  asset?: string
  rune_address?: string
  asset_address?: string
  units?: string
  pending_rune?: string
  pending_asset?: string
  pending_tx_id?: string
  last_add_height?: number
}

/**
 * Fetch a single LP position directly from thornode. Catches the
 * pending-only case Midgard doesn't surface. Returns null when the
 * position is truly empty (no units, no pending on either side).
 */
export const getThorchainLpPositionFromThornode = async ({
  thorAddress,
  pool,
}: GetThorchainLpPositionInput): Promise<ThorchainLpPosition | null> => {
  assertValidPoolId(pool)
  const url =
    `${cosmosRpcUrl[Chain.THORChain]}/thorchain/pool/${encodeURIComponent(pool)}` +
    `/liquidity_provider/${encodeURIComponent(thorAddress)}`
  let raw: RawThornodeLp
  try {
    raw = await queryUrl<RawThornodeLp>(url)
  } catch (err) {
    // thornode returns 404 when no LP record exists for the address on
    // this pool. Treat as "no position" same as Midgard.
    if (err instanceof HttpResponseError && err.status === 404) return null
    throw err
  }
  const units = raw.units ?? '0'
  const pendingRune = raw.pending_rune ?? '0'
  const pendingAsset = raw.pending_asset ?? '0'
  // Thornode always returns the endpoint with zeroed fields after a full
  // withdraw, so explicitly guard "everything is zero" as "no position".
  if (
    !isNonZero(units) &&
    !isNonZero(pendingRune) &&
    !isNonZero(pendingAsset)
  ) {
    return null
  }
  return {
    pool: raw.asset ?? pool,
    liquidityUnits: units,
    // Thornode doesn't track historical added amounts — those are a
    // Midgard-only enrichment. Surface them as 0; the caller can still
    // act on units/pending.
    runeAdded: '0',
    assetAdded: '0',
    runePending: pendingRune,
    assetPending: pendingAsset,
    runeAddress: raw.rune_address ?? thorAddress,
    assetAddress: raw.asset_address ?? '',
    dateLastAdded:
      typeof raw.last_add_height === 'number'
        ? String(raw.last_add_height)
        : '0',
    isPending: isNonZero(pendingRune) || isNonZero(pendingAsset),
  }
}
