/**
 * Exact base-units → human decimal-string conversion.
 *
 * `fromChainAmount` round-trips through float64 (`Number(amount) / 10**decimals`),
 * which silently loses precision once the raw amount exceeds 2^53 (~0.009 tokens
 * at 18 decimals) — `.toFixed(decimals)` then fabricates digits, so the displayed
 * amount can differ from the quoted one (e.g. `999999999999999999999999` raw at
 * 18dp renders as `1000000.000000000000000000`). This variant is pure bigint
 * string arithmetic — no precision loss for any magnitude.
 *
 * Output format matches `fromChainAmount(x, d).toFixed(d)`: an unsigned decimal
 * with exactly `decimals` fraction digits (no fraction part when `decimals` is 0),
 * so it is a drop-in replacement for display fields like `toAmountDecimal`.
 *
 * Accepts the integer base-unit shapes quote APIs return: bigint, or a base-10
 * integer string. Throws on anything else — a non-integer quote amount must be
 * handled by the caller, never silently floated.
 */
export const fromChainAmountExact = (amount: bigint | string, decimals: number): string => {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`fromChainAmountExact: invalid decimals ${decimals}`)
  }

  const raw = typeof amount === 'bigint' ? amount : BigInt(amount.trim())

  if (raw < 0n) {
    throw new Error('fromChainAmountExact: negative amounts are not supported')
  }

  const s = raw.toString().padStart(decimals + 1, '0')

  if (decimals === 0) {
    return s
  }

  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`
}

const isIntegerString = (value: string): boolean => /^\d+$/.test(value.trim())

/**
 * Display-oriented variant with a legacy fallback: exact conversion for the
 * integer base-unit strings quote APIs are contracted to return, and the old
 * float64 `.toFixed(decimals)` behaviour for anything else (some aggregators
 * have been observed returning non-integer `dstAmount` strings — see
 * SDK-CORRECTNESS-04; a display field must not throw mid-build over one).
 */
export const fromChainAmountDisplay = (amount: bigint | string, decimals: number): string => {
  if (typeof amount === 'bigint' || isIntegerString(amount)) {
    return fromChainAmountExact(amount, decimals)
  }

  return (Number(amount) / Math.pow(10, decimals)).toFixed(decimals)
}
