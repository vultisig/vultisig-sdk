/**
 * Pure unit-/decimals- and fiat-conversion primitives.
 *
 * This is the canonical `sdk.amount.convert` surface called out in the
 * mcp-ts/backend → SDK code-as-action consolidation. It folds three
 * previously-duplicated implementations into one:
 *
 *   - mcp-ts `tools/utility/convert-amount.ts` (`toBaseUnits` / `toHumanUnits`,
 *     pure string math, zero SDK imports)
 *   - Go `validator/{amount,decimals}.go` `scaleRawToHuman` / `bigPow10`
 *     (raw ÷ 10^decimals scale logic — the math kernel, minus the
 *     agent-layer prose regexes which stay in orchestration)
 *   - the existing SDK `fiatToAmount` (fiat → crypto via a live price feed)
 *
 * Everything here is PURE: no network, no vault, no LLM/agent concepts. The
 * base↔human conversions use string arithmetic (not float / not big.Float) so
 * there is zero precision loss on large base-unit integers — a `Number`-based
 * scale silently corrupts amounts above 2^53 wei.
 *
 * Fiat↔crypto here takes the price as an INPUT (the caller fetches it, e.g.
 * via the SDK price helpers or `fiatToAmount`). Keeping the price out of this
 * module is what keeps it pure and synchronous.
 */

/** Thrown when an amount/decimals conversion receives invalid input. Message is LLM-readable. */
export class AmountConvertError extends Error {
  override readonly name = 'AmountConvertError'

  constructor(message: string) {
    super(message)
  }
}

/** Direction for base-unit ↔ human-readable conversion. */
export type AmountDirection = 'to_base' | 'to_human'

/**
 * Decimals upper bound. Mirrors the Go validator + the mcp-ts zod schema
 * (`.min(0).max(255)`). No real token exceeds this; a larger value is almost
 * always a caller bug (e.g. passing a base-unit string where decimals belong).
 */
const MAX_DECIMALS = 255

const assertDecimals = (decimals: number): void => {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new AmountConvertError(
      `Invalid decimals "${decimals}" — must be an integer in [0, ${MAX_DECIMALS}]. ` +
        'Caller MUST supply token-specific decimals (USDC/USDT=6, ETH/most ERC-20=18).'
    )
  }
}

/**
 * Convert a human-readable decimal amount to its integer base-unit string.
 *
 * Pure string arithmetic — no precision loss for any size of amount. The
 * fractional part is truncated (NOT rounded) to `decimals` digits, matching
 * on-chain behaviour: you cannot send fractions of the smallest unit.
 *
 * @example
 * toBaseUnits('1.5', 18)   // '1500000000000000000'
 * toBaseUnits('100', 6)    // '100000000'
 * toBaseUnits('0.0', 18)   // '0'
 */
export const toBaseUnits = (amount: string, decimals: number): string => {
  assertDecimals(decimals)
  const trimmed = amount.trim()
  if (trimmed === '') {
    throw new AmountConvertError('Empty amount.')
  }

  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed

  // Reject scientific notation / stray characters — a base-unit string must be
  // an exact decimal, never "1e18" (which would silently scale wrong).
  if (!/^\d*\.?\d*$/.test(unsigned) || unsigned === '' || unsigned === '.') {
    throw new AmountConvertError(`Invalid amount "${amount}" — expected a plain decimal string.`)
  }

  const [wholePart = '0', fracPartRaw = ''] = unsigned.split('.')
  const whole = wholePart === '' ? '0' : wholePart

  // Pad or truncate fractional part to exactly `decimals` length.
  const frac = fracPartRaw.length > decimals ? fracPartRaw.slice(0, decimals) : fracPartRaw.padEnd(decimals, '0')

  // Concatenate and strip leading zeros (preserving a single zero).
  const raw = (whole + frac).replace(/^0+/, '') || '0'
  return negative && raw !== '0' ? `-${raw}` : raw
}

/**
 * Convert an integer base-unit string to its human-readable decimal string.
 *
 * Pure string arithmetic. Trailing zeros are trimmed. This is the TS twin of
 * Go's `scaleRawToHuman` (raw ÷ 10^decimals) but precision-exact.
 *
 * @example
 * toHumanUnits('1500000000000000000', 18) // '1.5'
 * toHumanUnits('100000000', 6)            // '100'
 * toHumanUnits('1', 18)                   // '0.000000000000000001'
 */
export const toHumanUnits = (amount: string, decimals: number): string => {
  assertDecimals(decimals)
  const trimmed = amount.trim()
  if (trimmed === '') {
    throw new AmountConvertError('Empty amount.')
  }

  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed

  if (!/^\d+$/.test(unsigned)) {
    throw new AmountConvertError(`Invalid base-unit amount "${amount}" — expected an integer string.`)
  }

  const sign = negative && unsigned.replace(/0+/, '') !== '' ? '-' : ''

  if (decimals === 0) {
    return `${sign}${unsigned.replace(/^0+(?=\d)/, '')}`
  }

  const padded = unsigned.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, '')
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '')

  return frac.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${frac}`
}

export type ConvertAmountParams = {
  /** Decimal amount as a string (human-readable for `to_base`, base-unit integer for `to_human`). */
  amount: string
  /** Token decimals (USDC/USDT=6, ETH/most ERC-20=18). Integer in [0, 255]. */
  decimals: number
  /** Conversion direction. */
  direction: AmountDirection
}

/**
 * Convert a token amount between human-readable and base units.
 *
 * @throws {AmountConvertError} On invalid input.
 *
 * @example
 * convertAmount({ amount: '1.5', decimals: 18, direction: 'to_base' })  // '1500000000000000000'
 * convertAmount({ amount: '100000000', decimals: 6, direction: 'to_human' }) // '100'
 */
export const convertAmount = ({ amount, decimals, direction }: ConvertAmountParams): string =>
  direction === 'to_base' ? toBaseUnits(amount, decimals) : toHumanUnits(amount, decimals)

const parsePositiveNumber = (value: number | string, label: string): number => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw new AmountConvertError(`Invalid ${label} "${value}" — must be a positive number.`)
  }
  return n
}

/**
 * Format a JS number as a decimal string capped to `decimals` fractional
 * digits with trailing zeros trimmed. Prefers `toString()` (shortest
 * round-trip) and falls back to `toFixed` only to expand scientific notation.
 * Behaviour kept byte-aligned with `fiatToAmount`'s formatter.
 */
const formatDecimalString = (value: number, decimals: number): string => {
  if (!Number.isFinite(value)) {
    throw new AmountConvertError(`Non-finite amount computed: ${value}`)
  }
  const str = /[eE]/.test(value.toString()) ? value.toFixed(decimals) : value.toString()
  if (!str.includes('.')) return str
  const [whole, fraction] = str.split('.')
  const trimmed = fraction.slice(0, decimals).replace(/0+$/, '')
  return trimmed === '' ? whole : `${whole}.${trimmed}`
}

export type FiatToCryptoParams = {
  /** Fiat value to convert (e.g. 100 for $100). Positive number or numeric string. */
  fiatValue: number | string
  /** Unit price of one whole token in the same fiat currency (caller-supplied). */
  price: number | string
  /** Token decimals — caps the fractional precision of the returned human-readable string. */
  decimals: number
}

/**
 * Convert a fiat value to a human-readable crypto amount given a unit price.
 *
 * `amount = fiatValue / price`, then capped to `decimals` fractional digits.
 * Pure + synchronous — the price is an INPUT. For a live-price variant that
 * fetches the rate itself, use `fiatToAmount`.
 *
 * @example
 * fiatToCrypto({ fiatValue: 100, price: 2000, decimals: 18 }) // '0.05'  ($100 of ETH @ $2000)
 */
export const fiatToCrypto = ({ fiatValue, price, decimals }: FiatToCryptoParams): string => {
  assertDecimals(decimals)
  const value = parsePositiveNumber(fiatValue, 'fiat value')
  const unitPrice = parsePositiveNumber(price, 'price')
  return formatDecimalString(value / unitPrice, decimals)
}

export type CryptoToFiatParams = {
  /** Human-readable crypto amount (e.g. '0.05'). Positive number or numeric string. */
  amount: number | string
  /** Unit price of one whole token in the target fiat currency (caller-supplied). */
  price: number | string
  /** Fiat fractional digits to keep (defaults to 2 — cents). */
  fiatDecimals?: number
}

/**
 * Convert a human-readable crypto amount to its fiat value given a unit price.
 *
 * `fiat = amount * price`, rounded to `fiatDecimals` (default 2).
 *
 * @example
 * cryptoToFiat({ amount: 0.05, price: 2000 }) // '100'
 */
export const cryptoToFiat = ({ amount, price, fiatDecimals = 2 }: CryptoToFiatParams): string => {
  if (!Number.isInteger(fiatDecimals) || fiatDecimals < 0 || fiatDecimals > MAX_DECIMALS) {
    throw new AmountConvertError(`Invalid fiatDecimals "${fiatDecimals}" — must be an integer in [0, ${MAX_DECIMALS}].`)
  }
  const value = parsePositiveNumber(amount, 'amount')
  const unitPrice = parsePositiveNumber(price, 'price')
  return formatDecimalString(value * unitPrice, fiatDecimals)
}
