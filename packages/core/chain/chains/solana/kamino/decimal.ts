/**
 * Strict-format parsing for Kamino's numeric JSON, which arrives as decimal
 * strings (`"0.03994268764493801732"`, `"1.0536041812651029025"`).
 *
 * The format is validated rather than coerced: grouping separators, exponents
 * and whitespace are rejected instead of being silently mis-read. What this
 * does not guarantee is exactness — a JS `number` holds ~16 significant digits
 * and Kamino publishes longer values. That is acceptable for the display
 * values `parseKaminoDisplayDecimal` is used on (APY, PnL, prices). Anything
 * that sizes a transaction must use `KaminoRate`, which is exact.
 */

/**
 * Whether `raw` is a plain decimal string: optional leading `-`, ASCII digits,
 * at most one `.`, at least one digit. Everything else — grouping separators,
 * exponents, whitespace, non-ASCII digits — is rejected.
 */
export const isPlainKaminoDecimal = (raw: string): boolean => {
  if (!raw) return false

  let hasDigit = false
  let hasSeparator = false
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index]
    if (character === '-') {
      if (index !== 0) return false
    } else if (character === '.') {
      if (hasSeparator) return false
      hasSeparator = true
    } else if (character >= '0' && character <= '9') {
      hasDigit = true
    } else {
      return false
    }
  }
  return hasDigit
}

/**
 * Parses a display-only value (APY, price, PnL) after strict format
 * validation, or `undefined` when the format is not a plain decimal. Never use
 * the result to size a transaction — it round-trips through a binary double.
 */
export const parseKaminoDisplayDecimal = (raw: string): number | undefined => {
  if (!isPlainKaminoDecimal(raw)) return undefined
  return Number(raw)
}
