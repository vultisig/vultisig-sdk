import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { thorchainMidgardBaseUrl } from './pools'
import type { ThorchainLpPosition } from './position'

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
  lastAddHeight: '',
  isPending: isNonZero(raw.runePending) || isNonZero(raw.assetPending),
})

/**
 * Fetch every LP position for a THORChain address in a single Midgard call.
 *
 * Returns an empty array when:
 *   - the address has no positions at all (Midgard returns 404), or
 *   - Midgard returns a body without a `pools` array (defensive).
 *
 * Prefer this over calling `getThorchainLpPosition` N times — one HTTP
 * round-trip regardless of position count.
 */
export const getThorchainLpPositions = async ({
  thorAddress,
}: {
  thorAddress: string
}): Promise<ThorchainLpPosition[]> => {
  const url = `${thorchainMidgardBaseUrl}/v2/member/${encodeURIComponent(thorAddress)}`
  let raw: RawMemberResponse
  try {
    raw = await queryUrl<RawMemberResponse>(url)
  } catch (err) {
    if (err instanceof HttpResponseError && err.status === 404) return []
    throw err
  }
  // Shape gates on the 200 response:
  //   - `raw` must be an object (not null, not a primitive, not an array of
  //     something unrelated) — otherwise the upstream shape is unrecognizable
  //     and we throw so the caller sees a real error.
  //   - `raw.pools` is allowed to be missing (treated as "no positions")
  //     for backward compat with the pre-404 era, when Midgard would
  //     return `{}` for known-empty addresses. A missing `pools` key is
  //     NOT treated as schema drift.
  //   - `raw.pools` MUST be an array if present — a non-array `pools`
  //     IS schema drift and we throw.
  if (!raw || typeof raw !== 'object') {
    throw new Error(
      `getThorchainLpPositions: unexpected Midgard response shape from ${url}`
    )
  }
  if (raw.pools === undefined) {
    return []
  }
  if (!Array.isArray(raw.pools)) {
    throw new Error(
      `getThorchainLpPositions: Midgard response ${url} has non-array \`pools\` field`
    )
  }
  return raw.pools.map(normalizeMemberPool)
}
