/**
 * Pure amount/decimal reconciliation helpers for the policy diff.
 *
 * Ported from the Go reference `internal/safety/policy.go`
 * (`sanitizeAmount`, `isZeroAmount`, `parseAmountBig`, `scaleDecimalClaimToAtomic`,
 * `claimInterpretations`, `amountDriftPct`). All arithmetic is exact `bigint`
 * string arithmetic — no floats in the scaling path, no precision loss. The
 * float ratio from {@link amountDriftPct} is for the human-readable reason only;
 * the WARN/BLOCK decision is taken on that ratio exactly as the Go reference does.
 */

import type { AmountUnits } from './types'

/** Thresholds (D4): warn on amount drift > 0.1%, block on > 1%. */
export const AMOUNT_DRIFT_WARN_PCT = 0.001
export const AMOUNT_DRIFT_BLOCK_PCT = 0.01

/**
 * The universe of decimals real tokens use. When a human-units claim must be
 * reconciled against a raw envelope amount and the token's actual decimals are
 * UNKNOWN, scaling the claim through this ladder keeps legit standard tokens
 * passing (USDC@6, BTC-likes@8, SOL@9, ETH@18, plus the raw atomic reading)
 * while a decimal-shift mutation lands BETWEEN rungs and still blocks.
 * Mirrors the Go `plausibleTokenDecimals`.
 */
export const PLAUSIBLE_TOKEN_DECIMALS: readonly number[] = [6, 8, 9, 12, 18]

/** Strips commas and spaces (matches the Go `sanitizeAmount` exactly — `$` is NOT stripped). */
export function sanitizeAmount(s: string): string {
  return s.replace(/,/g, '').replace(/ /g, '').trim()
}

/**
 * Reports whether a human amount string represents zero, tolerant of the
 * zero-like shapes the I2 check must NOT treat as "non-zero" ("0", "0.0",
 * "000", "0,000") while still treating "0.25" as non-zero. Falls back to false
 * for non-numeric shapes ("max", "all") so the zero special-case never fires on
 * a drain literal. Mirrors the Go `isZeroAmount`.
 */
export function isZeroAmount(s: string): boolean {
  const sanitized = sanitizeAmount(s)
  if (sanitized === '') {
    return false
  }
  // strconv.ParseFloat-equivalent: a finite number that equals 0.
  // Reject any shape Go's ParseFloat would reject (stray chars, multiple dots).
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(sanitized)) {
    return false
  }
  const f = Number(sanitized)
  return Number.isFinite(f) && f === 0
}

/**
 * Attempts to parse a human-readable amount string into a `bigint`. Handles
 * integer strings; returns null for floats (can't safely convert without
 * knowing decimals) or non-numeric shapes. Mirrors the Go `parseAmountBig`.
 */
export function parseAmountBig(s: string): bigint | null {
  const sanitized = sanitizeAmount(s)
  // Has a decimal point — can't convert to bigint safely without decimals.
  if (sanitized.includes('.')) {
    return null
  }
  // Go's big.Int.SetString(s, 10): accepts an optional leading sign + digits.
  if (!/^[+-]?\d+$/.test(sanitized)) {
    return null
  }
  try {
    return BigInt(sanitized)
  } catch {
    return null
  }
}

/**
 * Converts a human-readable claim ("0.25", "1.5", "2") into raw atomic units
 * using the token's decimals ("0.25" + 18 → 250000000000000000n). Exact bigint
 * string arithmetic. Returns null when decimals are unknown (0), the string
 * isn't a plain number (drain words "all"/"max", empty, multiple dots, stray
 * characters), or the fraction carries more digits than the token supports.
 * Mirrors the Go `scaleDecimalClaimToAtomic`.
 */
export function scaleDecimalClaimToAtomic(s: string, decimals: number): bigint | null {
  if (decimals === 0) {
    return null
  }
  const sanitized = sanitizeAmount(s)
  if (sanitized === '') {
    return null
  }
  let intPart = sanitized
  let fracPart = ''
  const i = sanitized.indexOf('.')
  if (i >= 0) {
    intPart = sanitized.slice(0, i)
    fracPart = sanitized.slice(i + 1)
    if (fracPart.includes('.')) {
      return null // "1.2.3" — not a number
    }
  }
  if (intPart === '') {
    intPart = '0' // ".5" form
  }
  if (fracPart.length > decimals) {
    return null
  }
  const digits = intPart + fracPart + '0'.repeat(decimals - fracPart.length)
  // Reject any non-digit (e.g. "max", "1e3", a stray sign in the fraction).
  if (!/^\d+$/.test(digits)) {
    return null
  }
  try {
    return BigInt(digits)
  } catch {
    return null
  }
}

/**
 * Returns the atomic-unit interpretation(s) of a claim to drift-check against a
 * decoded envelope amount, honoring the claim's units provenance:
 *   - 'base'                  → ONLY the raw integer parse
 *   - 'human' + KNOWN decimals → ONLY the scaled interpretation
 *   - 'human' + unknown decimals → atomic + the plausible-decimals ladder
 *   - '' (unknown provenance)  → the same ladder (legacy callers)
 * Only positive interpretations are returned. Mirrors the Go `claimInterpretations`.
 */
export function claimInterpretations(amount: string, units: AmountUnits, decimals: number): bigint[] {
  const out: bigint[] = []
  const add = (n: bigint | null): void => {
    if (n !== null && n > 0n) {
      out.push(n)
    }
  }
  if (units === 'base') {
    add(parseAmountBig(amount))
  } else if (units === 'human' && decimals > 0) {
    add(scaleDecimalClaimToAtomic(amount, decimals))
  } else {
    add(parseAmountBig(amount))
    for (const d of PLAUSIBLE_TOKEN_DECIMALS) {
      add(scaleDecimalClaimToAtomic(amount, d))
    }
  }
  return out
}

/**
 * Returns the relative drift |claimed-observed|/claimed as a number. Returns 0
 * when `claimed` is zero to avoid division by zero. Computed from exact bigint
 * magnitudes; the final ratio is a double (matches the Go `amountDriftPct`,
 * which converts through big.Float for the percentage). Mirrors the Go reference.
 *
 * Saturates to Infinity (not NaN) when either operand overflows Number.MAX_SAFE_INTEGER,
 * because Infinity > any threshold always = true (BLOCK), whereas NaN > threshold = false
 * which would silently bypass policy checks on extreme amounts.
 */
export function amountDriftPct(claimed: bigint, observed: bigint): number {
  if (claimed === 0n) {
    return 0
  }
  let diff = observed - claimed
  if (diff < 0n) {
    diff = -diff
  }
  const absClaimed = claimed < 0n ? -claimed : claimed
  // Keep diff-vs-claimed comparison in bigint to avoid NaN from Infinity/Infinity.
  // Scale diff to a ratio * 1e9 in integer space, then convert once.
  const SCALE = 1_000_000_000n
  const ratioBig = (diff * SCALE) / absClaimed
  return Number(ratioBig) / 1e9
}
