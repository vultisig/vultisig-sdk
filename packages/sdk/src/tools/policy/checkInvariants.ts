/**
 * checkInvariants — asserts the I1-I7 fund-safety invariants on a decoded
 * envelope and returns EVERY violation (empty array = all hold).
 *
 * Ported from the Go reference `internal/safety/policy.go`
 * (`CheckInvariants` + `invariantI6Diffs`). Unlike {@link evaluatePolicy} (which
 * returns the FIRST blocking verdict), this checks each invariant independently
 * so a harness can attribute a failure to the specific guarantee that broke.
 *
 * PURE comparison only — it reads an already-decoded envelope + a structured
 * claim; it never decodes, signs, or broadcasts. I4 (no-sign-without-confirm)
 * is a boolean flow assertion the caller feeds in, not a signing action.
 */

import { AMOUNT_DRIFT_BLOCK_PCT, amountDriftPct, claimInterpretations, isZeroAmount, sanitizeAmount } from './amount'
import { chainsMatch } from './chains'
import type { FieldDiff, IntentClaim, InvariantInput, InvariantViolation } from './types'
import { Invariant } from './types'

const lower = (s: string | undefined): string => (s ?? '').trim().toLowerCase()

/**
 * Asserts I1-I7 and returns every violation. Optional inputs are skipped when
 * absent so a caller can assert only the invariants it has the inputs for.
 */
export function checkInvariants(input: InvariantInput): InvariantViolation[] {
  const v: InvariantViolation[] = []
  const { claim, envelope } = input
  const decoded = envelope.decoded === true

  // I3: chain == confirmed. On a DECODED envelope a stated chain the envelope
  // DROPPED (empty) is a divergence too, not just a non-alias mismatch.
  const claimChain = lower(claim.chain)
  const envChain = lower(envelope.chainId)
  if (decoded && claimChain !== '' && (envChain === '' || !chainsMatch(claimChain, envChain))) {
    v.push({
      invariant: Invariant.ChainMatchesIntent,
      reason: `chain mismatch: intent "${claimChain}", envelope "${envChain}"`,
      diff: [{ field: 'chain', claimed: claimChain, observed: envChain }],
    })
  }

  // I1: recipient == confirmed. Same empty-decoded-field strictness as I3.
  const claimRecipient = lower(claim.recipient)
  const envRecipient = lower(envelope.recipient)
  if (decoded && claimRecipient !== '' && claimRecipient !== envRecipient) {
    v.push({
      invariant: Invariant.RecipientMatchesIntent,
      reason: `recipient mismatch: intent "${claimRecipient}", envelope "${envRecipient}"`,
      diff: [{ field: 'recipient', claimed: claimRecipient, observed: envRecipient }],
    })
  }

  // I2: amount == confirmed. nil envelope amount = "decoder could not parse"
  // (fail open), NOT "sends zero" — only assess when the amount is known.
  if (decoded && (claim.amount ?? '') !== '' && envelope.amount != null) {
    const envAmount = envelope.amount
    const claimZero = isZeroAmount(claim.amount ?? '')
    const envZero = envAmount === 0n
    const envObserved = envAmount.toString()
    if (claimZero && envZero) {
      // both zero → match.
    } else if (claimZero && !envZero) {
      v.push({
        invariant: Invariant.AmountMatchesIntent,
        reason: `amount mismatch: intent zero ("${claim.amount}"), envelope sends "${envObserved}"`,
        diff: [{ field: 'amount', claimed: claim.amount ?? '', observed: envObserved }],
      })
    } else if (!claimZero && envZero) {
      v.push({
        invariant: Invariant.AmountMatchesIntent,
        reason: `amount mismatch: intent "${claim.amount}", envelope sends zero/none`,
        diff: [{ field: 'amount', claimed: claim.amount ?? '', observed: envObserved }],
      })
    } else {
      // Both non-zero → drift check under EVERY available unit interpretation.
      // A violation fires only when EVERY interpretation drifts > 1%.
      const decimals = envelope.asset?.decimals ?? 0
      const interps = claimInterpretations(claim.amount ?? '', claim.amountUnits ?? '', decimals)
      let drifted = 0
      for (const c of interps) {
        if (amountDriftPct(c, envAmount) > AMOUNT_DRIFT_BLOCK_PCT) {
          drifted++
        }
      }
      if (interps.length > 0 && drifted === interps.length) {
        v.push({
          invariant: Invariant.AmountMatchesIntent,
          reason: `amount drift exceeds ${(AMOUNT_DRIFT_BLOCK_PCT * 100).toFixed(0)}% under all ${interps.length} unit interpretation(s): intent "${claim.amount}", envelope "${envObserved}"`,
          diff: [{ field: 'amount', claimed: claim.amount ?? '', observed: envObserved }],
        })
      }
    }
  }

  // I4: no sign without an explicit confirmation.
  if (input.signing === true && input.confirmed !== true) {
    v.push({
      invariant: Invariant.NoSignWithoutConfirm,
      reason: 'sign requested without an explicit user confirmation',
      diff: [],
    })
  }

  // I5: amount never exceeds the available balance.
  if (input.balance != null && decoded && envelope.amount != null && envelope.amount > 0n) {
    if (envelope.amount > input.balance) {
      v.push({
        invariant: Invariant.NeverExceedBalance,
        reason: `amount ${envelope.amount.toString()} exceeds balance ${input.balance.toString()}`,
        diff: [{ field: 'amount', claimed: input.balance.toString(), observed: envelope.amount.toString() }],
      })
    }
  }

  // I7: a user-stated memo must reach the decoded envelope verbatim.
  if ((input.userMemo ?? '') !== '' && decoded) {
    const envMemo = (input.envelopeMemo ?? '').trim()
    if (envMemo === '') {
      v.push({
        invariant: Invariant.MemoPreserved,
        reason:
          'user stated a memo but the envelope memo is empty (dropped memo = funds lost or stuck on exchange deposits / XRPL tags / IBC PFM)',
        diff: [],
      })
    } else if (envMemo !== input.userMemo) {
      v.push({
        invariant: Invariant.MemoPreserved,
        reason: 'envelope memo differs from the user-stated memo (must be forwarded verbatim)',
        diff: [],
      })
    }
  }

  // I6: a tool output must not mutate the user-stated recipient/amount/chain.
  if (input.postToolClaim != null) {
    v.push(...invariantI6Diffs(claim, input.postToolClaim))
  }

  return v
}

/**
 * Reports the provenance violations: a tool output (a resolved address, a
 * contact lookup, a memory recall) CHANGED or CLEARED a fund field the user
 * already stated. Anchored on "orig was stated" — a field the user did NOT
 * state may be filled in legitimately. Only BLOCK-class fields are checked.
 * Mirrors the Go `invariantI6Diffs`.
 */
function invariantI6Diffs(orig: IntentClaim, postTool: IntentClaim): InvariantViolation[] {
  const v: InvariantViolation[] = []
  const add = (field: string, before: string, after: string): void => {
    v.push({
      invariant: Invariant.OutputCannotMutateIntent,
      reason: `tool output mutated ${field}: stated "${before}", post-tool "${after}"`,
      diff: [{ field, claimed: before, observed: after } as FieldDiff],
    })
  }

  const oRecip = lower(orig.recipient)
  const pRecip = lower(postTool.recipient)
  if (oRecip !== '' && oRecip !== pRecip) {
    add('recipient', oRecip, pRecip)
  }

  const oChain = lower(orig.chain)
  const pChain = lower(postTool.chain)
  if (oChain !== '' && (pChain === '' || !chainsMatch(oChain, pChain))) {
    add('chain', oChain, pChain)
  }

  // I6 amount is provenance, NOT drift-tolerance: ANY rewrite of a stated amount
  // is a mutation. Compare on the sanitized string so "1,000"=="1000", but
  // "0.25"->"0.3", "1000"->"1001", "$50"->"50", and a cleared amount all fire.
  const oAmtStr = (orig.amount ?? '').trim()
  if (oAmtStr !== '' && sanitizeAmount(oAmtStr) !== sanitizeAmount((postTool.amount ?? '').trim())) {
    add('amount', oAmtStr, (postTool.amount ?? '').trim())
  }

  return v
}
