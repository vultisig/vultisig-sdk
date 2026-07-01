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

// The wire is untrusted: the never-throw contract means a malformed element
// (`null`, `name: 123`, …) must be skipped, not allowed to throw. So rows are
// typed as opaque records and every field is read through a runtime guard.
type StakewizValidatorRow = Record<string, unknown>

const asTrimmedString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() || undefined : undefined

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * Stakewiz reports `apy_estimate` as a percentage (e.g. 5.72) — store as a
 * fraction. A genuine `0` is preserved (0% APY ≠ "no APY"); only missing /
 * non-finite / negative values collapse to `undefined`.
 */
const apyFraction = (percent: unknown): number | undefined => {
  const value = asFiniteNumber(percent)
  return value !== undefined && value >= 0 ? value / 100 : undefined
}

const toMetadata = (row: StakewizValidatorRow): ValidatorMetadata => {
  const wizScore = asFiniteNumber(row.wiz_score)
  return {
    name: asTrimmedString(row.name),
    logoUrl: asTrimmedString(row.image),
    apyEstimate: apyFraction(row.apy_estimate),
    score: wizScore === undefined ? undefined : Math.round(wizScore),
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
      return (await response.json()) as unknown
    })

    // Outage / rate-limit / malformed response — degrade to on-chain-only.
    if ('error' in result || !Array.isArray(result.data)) {
      return {}
    }

    const map: Record<string, ValidatorMetadata> = {}
    for (const row of result.data) {
      // Skip malformed elements (`null`, primitives, missing/invalid pubkey)
      // rather than letting a field access throw — the never-throw contract.
      if (typeof row !== 'object' || row === null) {
        continue
      }
      const votePubkey = asTrimmedString((row as StakewizValidatorRow).vote_identity)
      if (votePubkey && requested.has(votePubkey)) {
        map[votePubkey] = toMetadata(row as StakewizValidatorRow)
      }
    }
    return map
  },
}
