/**
 * evaluatePolicy — pure intent↔envelope field diff returning a Verdict.
 *
 * Ported from the Go reference `internal/safety/policy.go` (`EvaluatePolicy`).
 * Implements the D1/D4 rules:
 *   - BLOCK: critical field mismatch (chain, recipient) or amount drift > 1%
 *   - WARN:  amount drift 0.1%–1%; asset-symbol display-name drift
 *   - PASS:  everything within thresholds
 *
 * Fail-open on decode errors: an envelope with `decoded === false` returns WARN
 * (the security scanning seam handles that path; this layer only diffs intent).
 *
 * This is PURE comparison — no decode, no signing, no broadcast, no agent
 * judgement. It returns the FIRST blocking verdict (use {@link checkInvariants}
 * to attribute every independent violation).
 */

import { AMOUNT_DRIFT_BLOCK_PCT, AMOUNT_DRIFT_WARN_PCT, amountDriftPct, claimInterpretations } from './amount'
import { chainsMatch } from './chains'
import type { Envelope, FieldDiff, IntentClaim, Verdict } from './types'
import { ResultKind } from './types'

const lower = (s: string | undefined): string => (s ?? '').trim().toLowerCase()
const upper = (s: string | undefined): string => (s ?? '').trim().toUpperCase()

/**
 * Evaluates the decoded {@link Envelope} against the {@link IntentClaim} and
 * returns a {@link Verdict}.
 */
export function evaluatePolicy(claim: IntentClaim, envelope: Envelope): Verdict {
  if (!envelope.decoded) {
    return {
      result: ResultKind.Warn,
      reason: `envelope not decoded: ${envelope.decodeError ?? ''}`,
      diff: [],
    }
  }

  const diffs: FieldDiff[] = []

  // Chain check: BLOCK on mismatch. Normalise both sides to lowercase.
  const claimChain = lower(claim.chain)
  const envChain = lower(envelope.chainId)
  if (claimChain !== '' && envChain !== '' && !chainsMatch(claimChain, envChain)) {
    return {
      result: ResultKind.Block,
      reason: `chain mismatch: user claimed "${claimChain}", envelope has "${envChain}"`,
      diff: [{ field: 'chain', claimed: claimChain, observed: envChain }],
    }
  }

  // Recipient check: BLOCK on mismatch when both are non-empty. EVM addresses
  // are case-insensitive; Cosmos bech32 is lowercase by convention.
  const claimRecipient = lower(claim.recipient)
  const envRecipient = lower(envelope.recipient)
  if (claimRecipient !== '' && envRecipient !== '' && claimRecipient !== envRecipient) {
    return {
      result: ResultKind.Block,
      reason: `recipient mismatch: user claimed "${claimRecipient}", envelope has "${envRecipient}"`,
      diff: [{ field: 'recipient', claimed: claimRecipient, observed: envRecipient }],
    }
  }

  // Amount check: WARN or BLOCK based on drift percentage. Drift is the MINIMUM
  // across the available unit interpretations — a verdict fires only when even
  // the most favorable reading drifts.
  const envAmount = envelope.amount
  if ((claim.amount ?? '') !== '' && envAmount != null && envAmount > 0n) {
    const decimals = envelope.asset?.decimals ?? 0
    const interps = claimInterpretations(claim.amount ?? '', claim.amountUnits ?? '', decimals)
    if (interps.length > 0) {
      let drift = amountDriftPct(interps[0], envAmount)
      for (let i = 1; i < interps.length; i++) {
        const d = amountDriftPct(interps[i], envAmount)
        if (d < drift) {
          drift = d
        }
      }
      if (drift > AMOUNT_DRIFT_BLOCK_PCT) {
        diffs.push({ field: 'amount', claimed: claim.amount ?? '', observed: envAmount.toString() })
        return {
          result: ResultKind.Block,
          reason: `amount drift ${(drift * 100).toFixed(2)}% exceeds block threshold ${(AMOUNT_DRIFT_BLOCK_PCT * 100).toFixed(0)}%`,
          diff: diffs,
        }
      }
      if (drift > AMOUNT_DRIFT_WARN_PCT) {
        diffs.push({ field: 'amount', claimed: claim.amount ?? '', observed: envAmount.toString() })
      }
    }
  }

  // Asset symbol check: WARN on mismatch (could be display-name drift).
  const claimAsset = upper(claim.asset)
  const envAsset = upper(envelope.asset?.symbol)
  if (claimAsset !== '' && envAsset !== '' && claimAsset !== envAsset) {
    diffs.push({ field: 'asset', claimed: claimAsset, observed: envAsset })
  }

  if (diffs.length > 0) {
    return {
      result: ResultKind.Warn,
      reason: `${diffs.length} field(s) differ between intent and envelope`,
      diff: diffs,
    }
  }

  return {
    result: ResultKind.Pass,
    reason: 'envelope matches intent claim',
    diff: [],
  }
}
