/**
 * Pure intent↔envelope policy diff (vault-free, no signing/broadcast).
 *
 * Ported from the Go reference `internal/safety/policy.go`. This is the PURE
 * comparison sub-layer of the safety stack: it diffs a structured
 * {@link IntentClaim} against an already-decoded {@link Envelope} and computes a
 * field-level diff + invariant checks. It does NOT extract intent from a natural
 * language message, score grounding, or detect prompt injection — that agent
 * judgement stays in the backend; this only diffs two structured objects.
 *
 * Consumed via the `policy` namespace:
 *   policy.evaluate(claim, envelope)         → Verdict   (first blocking decision)
 *   policy.checkInvariants(invariantInput)   → InvariantViolation[]  (all violations)
 */

import { checkInvariants } from './checkInvariants'
import { evaluatePolicy } from './evaluatePolicy'

export {
  AMOUNT_DRIFT_BLOCK_PCT,
  AMOUNT_DRIFT_WARN_PCT,
  amountDriftPct,
  claimInterpretations,
  isZeroAmount,
  parseAmountBig,
  PLAUSIBLE_TOKEN_DECIMALS,
  sanitizeAmount,
  scaleDecimalClaimToAtomic,
} from './amount'
export { chainAliasMap, chainsMatch } from './chains'
export { checkInvariants } from './checkInvariants'
export { evaluatePolicy } from './evaluatePolicy'
export type {
  AmountUnits,
  AssetRef,
  Envelope,
  FieldDiff,
  IntentClaim,
  InvariantInput,
  InvariantViolation,
  Verdict,
} from './types'
// Invariant and ResultKind are dual type+value (const-object merged with a type
// alias) — re-export as VALUES so consumers can use them at runtime AND as types.
export { Invariant, ResultKind } from './types'

/**
 * The `policy` namespace — the public surface for the intent↔envelope diff.
 *
 * @example
 * import { policy } from '@vultisig/sdk'
 * const verdict = policy.evaluate(
 *   { chain: 'base', recipient: '0xAAA', asset: 'USDC', amount: '1', amountUnits: 'human' },
 *   { decoded: true, chainId: 'base', recipient: '0xBBB', asset: { symbol: 'USDC', decimals: 6 }, amount: 1000000n },
 * )
 * // verdict.result === 'BLOCK' (recipient mismatch)
 */
export const policy = {
  /** Diff a claim against a decoded envelope → first blocking {@link Verdict}. */
  evaluate: evaluatePolicy,
  /** Assert I1-I7 fund-safety invariants → every {@link InvariantViolation}. */
  checkInvariants,
} as const
