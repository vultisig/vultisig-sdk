import { attempt } from '@vultisig/lib-utils/attempt'

import { ValidatorMetadata } from '../models/validator'
import { ValidatorMetadataProvider } from './ValidatorMetadataProvider'

/**
 * Concrete `ValidatorMetadataProvider` backed by Stakewiz
 * (https://api.stakewiz.com). The `/validators` endpoint returns the full
 * validator set in one response, so a single fetch enriches an arbitrary batch
 * of vote pubkeys. A failed or rate-limited fetch yields an empty map — the
 * call never throws, so callers degrade to on-chain-only display. The ~1h cache
 * is handled by the consuming react-query hook's `staleTime`.
 *
 * Field mapping (Stakewiz → ValidatorMetadata):
 *   name          → name
 *   image         → logoUrl
 *   apy_estimate  → apyEstimate  (percent on the wire, stored as a fraction)
 *   wiz_score     → score
 *
 * Port of iOS `StakewizValidatorMetadataProvider`.
 */
const stakewizValidatorsUrl = 'https://api.stakewiz.com/validators'

type StakewizValidatorRow = {
  vote_identity?: string
  name?: string | null
  image?: string | null
  apy_estimate?: number | null
  wiz_score?: number | null
}

/** Stakewiz reports `apy_estimate` as a percentage (e.g. 5.72) — store as a fraction. */
const apyFraction = (percent: number | null | undefined): number | undefined =>
  typeof percent === 'number' && Number.isFinite(percent) && percent > 0 ? percent / 100 : undefined

const toMetadata = (row: StakewizValidatorRow): ValidatorMetadata => {
  const name = row.name?.trim()
  const image = row.image?.trim()
  return {
    name: name || undefined,
    logoUrl: image || undefined,
    apyEstimate: apyFraction(row.apy_estimate),
    score: typeof row.wiz_score === 'number' ? Math.round(row.wiz_score) : undefined,
  }
}

export const stakewizValidatorMetadataProvider: ValidatorMetadataProvider = {
  metadata: async votePubkeys => {
    const requested = new Set(votePubkeys.filter(Boolean))
    if (requested.size === 0) {
      return {}
    }

    const result = await attempt(async () => {
      const response = await fetch(stakewizValidatorsUrl, {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Stakewiz responded ${response.status}`)
      }
      return (await response.json()) as StakewizValidatorRow[]
    })

    // Outage / rate-limit / malformed response — degrade to on-chain-only.
    if ('error' in result || !Array.isArray(result.data)) {
      return {}
    }

    const map: Record<string, ValidatorMetadata> = {}
    for (const row of result.data) {
      const votePubkey = row.vote_identity
      if (votePubkey && requested.has(votePubkey)) {
        map[votePubkey] = toMetadata(row)
      }
    }
    return map
  },
}
