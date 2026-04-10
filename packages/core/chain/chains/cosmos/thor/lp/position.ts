import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { THORCHAIN_MIDGARD_BASE_URL } from './pools'

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
export const getThorchainLpPosition = async ({
  thorAddress,
  pool,
}: GetThorchainLpPositionInput): Promise<ThorchainLpPosition | null> => {
  const url = `${THORCHAIN_MIDGARD_BASE_URL}/v2/member/${encodeURIComponent(thorAddress)}`
  let raw: RawMemberResponse
  try {
    raw = await queryUrl<RawMemberResponse>(url)
  } catch (err) {
    // Midgard returns 404 for any address it has not indexed yet.
    // queryUrl bubbles fetch errors as Error — we treat 404 as "no position".
    if (err instanceof Error && /\b404\b/.test(err.message)) return null
    throw err
  }
  const found = raw.pools?.find(p => p.pool === pool)
  return found ? normalizeMemberPool(found) : null
}
