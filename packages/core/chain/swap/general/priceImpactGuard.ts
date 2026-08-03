/**
 * Shared price-impact fund-safety guard for swap providers that EXPOSE a
 * price-impact field on their quote.
 *
 * Fund-safety gap (audit finding SOL-02, vultisig-sdk#1049): a thin-pool /
 * sandwich-bait Jupiter quote at 50-90% price impact still built a fully
 * signable, MPC-ready swap transaction with zero protection — the provider's
 * own min-out was the only guard, and for wide-default routes that loses most
 * of the user's funds. This module adds a PRICE-IMPACT CEILING: any quote
 * whose exposed impact exceeds {@link MAX_PRICE_IMPACT_PCT} is refused.
 *
 * Ported from mcp-ts `src/tools/swap/priceImpactGuard.ts` (bead
 * vultisig-ops-1m48), which enforces the identical 10% ceiling against the
 * identical Jupiter `priceImpactPct` fraction convention on the production
 * agent path. Keeping the SDK swap-build path and the agent swap path on the
 * same ceiling avoids the exact drift this finding flagged.
 */

/**
 * Maximum tolerated price impact, in PERCENT, before a swap quote is refused.
 *
 * 10% is far above any normal swap (the vast majority quote <1%, and even a
 * chunky trade through a deep pool stays well under a few percent), yet
 * comfortably below the 50-90% sandwich-bait / thin-pool range this guards
 * against. Intentionally conservative on the safe side: a false refusal is
 * recoverable (the user re-confirms with a smaller size or deeper route), a
 * false pass drains funds.
 */
export const MAX_PRICE_IMPACT_PCT = 10

export type PriceImpactDecision = { ok: true; impactPct: number | null } | { ok: false; impactPct: number }

/**
 * Evaluate a price-impact value (already normalised to PERCENT units)
 * against the ceiling.
 *
 * Fail-SAFE semantics: a missing / non-finite / negative impact is treated
 * as "no usable signal" and PASSES (`ok: true, impactPct: null`). We never
 * reject on a sometimes-undefined field — that would over-block normal swaps
 * whenever the provider omits the value. Rejection only fires on a finite
 * impact strictly above the ceiling.
 */
export const evaluatePriceImpactPercent = (impactPercent: number | null | undefined): PriceImpactDecision => {
  if (impactPercent == null || !Number.isFinite(impactPercent) || impactPercent < 0) {
    return { ok: true, impactPct: null }
  }
  if (impactPercent > MAX_PRICE_IMPACT_PCT) {
    return { ok: false, impactPct: impactPercent }
  }
  return { ok: true, impactPct: impactPercent }
}

/**
 * Parse a provider impact string expressed as a FRACTION (e.g. Jupiter's
 * `priceImpactPct` = "0.05" meaning 5%) and evaluate it. The fraction is
 * multiplied by 100 to normalise to percent before comparing against the
 * ceiling.
 */
export const evaluateImpactFromFractionString = (raw: string | null | undefined): PriceImpactDecision => {
  const parsed = raw == null ? NaN : Number.parseFloat(raw)
  return evaluatePriceImpactPercent(Number.isFinite(parsed) ? parsed * 100 : null)
}

/**
 * Build a human-readable refusal message for a high-impact quote.
 */
export const highImpactMessage = (impactPct: number): string =>
  `This swap has ${impactPct.toFixed(2)}% price impact, above the ${MAX_PRICE_IMPACT_PCT}% ceiling. ` +
  `A price impact this high usually means a thin pool or an oversized trade and would lose most of the ` +
  `value being swapped. Refusing to build a signable transaction. If you genuinely want to proceed, ` +
  `reduce the trade size or pick a deeper-liquidity route.`

/**
 * Thrown when a quote's price impact exceeds {@link MAX_PRICE_IMPACT_PCT}.
 * Carried as a distinct type so callers/tests can recognise a high-impact
 * refusal versus a generic quote/build failure.
 */
export class PriceImpactTooHighError extends Error {
  readonly impactPercent: number

  constructor(impactPercent: number) {
    super(highImpactMessage(impactPercent))
    this.name = 'PriceImpactTooHighError'
    this.impactPercent = impactPercent
  }
}

/**
 * Parse + evaluate a provider's fraction-convention `priceImpactPct` and
 * throw {@link PriceImpactTooHighError} when it exceeds the ceiling. No-op
 * (returns) when the impact is missing, unparsable, or within bounds.
 */
export const assertJupiterPriceImpactWithinCeiling = (priceImpactPct: string | null | undefined): void => {
  const decision = evaluateImpactFromFractionString(priceImpactPct)
  if (!decision.ok) {
    throw new PriceImpactTooHighError(decision.impactPct)
  }
}
