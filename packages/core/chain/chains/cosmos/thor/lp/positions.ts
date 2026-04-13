import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { normalizeMemberPool } from './memberPool'
import { thorchainMidgardBaseUrl } from './pools'
import type { RawMemberResponse, ThorchainLpPosition } from './types'

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
