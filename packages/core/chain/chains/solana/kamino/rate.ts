import { renderKaminoBaseUnits } from './baseUnits'
import { isPlainKaminoDecimal } from './decimal'

/**
 * An exact decimal value from the API, held as `numerator / 10^scale`.
 *
 * This exists because floating-point (and any fixed-precision decimal)
 * arithmetic rounds. A share rate drives how many shares a withdraw burns, and
 * the API does not validate amounts — it rewrites an over-sized withdraw to
 * `u64::MAX`, meaning *withdraw everything*. A division that rounded up at the
 * far end of the mantissa could therefore turn a partial withdraw into a full
 * exit. Integer arithmetic removes the question.
 */
export type KaminoRate = {
  numerator: bigint
  /** Denominator exponent: the value is `numerator / 10^scale`. */
  scale: number
}

/**
 * Parses Kamino's decimal-string form exactly, with no intermediate binary or
 * fixed-precision representation. `undefined` when the string is not a plain
 * decimal.
 */
export const parseKaminoRate = (raw: string): KaminoRate | undefined => {
  if (!isPlainKaminoDecimal(raw)) return undefined

  const separatorIndex = raw.indexOf('.')
  const whole = separatorIndex === -1 ? raw : raw.slice(0, separatorIndex)
  const fraction = separatorIndex === -1 ? '' : raw.slice(separatorIndex + 1)

  // isPlainKaminoDecimal guarantees at least one digit, so `digits` is never
  // empty even for forms like ".5" or "-.5".
  const sign = whole.startsWith('-') ? -1n : 1n
  const digits = (whole.startsWith('-') ? whole.slice(1) : whole) + fraction

  return {
    numerator: sign * BigInt(digits),
    scale: fraction.length,
  }
}

/** Whether the rate names a value strictly above zero. */
export const isPositiveKaminoRate = (rate: KaminoRate): boolean => rate.numerator > 0n

/**
 * This value's numerator at `targetScale` decimal places, or `undefined` when
 * the target is too coarse to hold it without loss.
 */
export const kaminoRateNumeratorAtScale = (rate: KaminoRate, targetScale: number): bigint | undefined => {
  if (targetScale < rate.scale) return undefined
  return rate.numerator * 10n ** BigInt(targetScale - rate.scale)
}

/**
 * The exact sum of two API decimal strings, or `undefined` when either is not
 * one.
 *
 * Exists so two reported figures can be added at the precision they were
 * reported at, rather than after each has been truncated to a mint's scale.
 * See `parseKaminoSharePosition` for why that distinction is the difference
 * between a guard and a false refusal.
 */
export const sumKaminoRates = (lhs: string, rhs: string): KaminoRate | undefined => {
  const left = parseKaminoRate(lhs)
  const right = parseKaminoRate(rhs)
  if (!left || !right) return undefined

  const scale = Math.max(left.scale, right.scale)
  const a = kaminoRateNumeratorAtScale(left, scale)
  const b = kaminoRateNumeratorAtScale(right, scale)
  if (a === undefined || b === undefined) return undefined

  return { numerator: a + b, scale }
}

/**
 * Whether `raw` names exactly the same number as `rate`. `false` when it is
 * not a plain decimal at all — an unreadable figure is never equal to a
 * readable one.
 */
export const kaminoRateEquals = (rate: KaminoRate, raw: string): boolean => {
  const other = parseKaminoRate(raw)
  if (!other) return false

  const scale = Math.max(rate.scale, other.scale)
  const a = kaminoRateNumeratorAtScale(rate, scale)
  const b = kaminoRateNumeratorAtScale(other, scale)
  return a !== undefined && b !== undefined && a === b
}

/**
 * Renders the rate back to its plain decimal-string form (no trailing zeros,
 * no exponent).
 */
export const renderKaminoRate = (rate: KaminoRate): string =>
  renderKaminoBaseUnits({ baseUnits: rate.numerator, decimals: rate.scale })
