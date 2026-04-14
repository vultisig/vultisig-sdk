import { parseUnits } from 'viem'

/** Thrown when a human amount string cannot be converted to chain base units. */
export class ChainAmountParseError extends Error {
  override readonly name = 'ChainAmountParseError'

  constructor(message: string) {
    super(message)
  }
}

const SCIENTIFIC_DECIMAL = /^([+-]?)(?:(\d+)\.?(\d*)|\.(\d+))[eE]([+-]?\d+)$/i

/** Limits `10n ** |scale|` work and expanded string size for untrusted input. */
const MAX_SCALE_ABS = 10_000n

const padFractionDigits = (frac: string, totalLen: bigint): string => {
  const need = totalLen - BigInt(frac.length)
  if (need <= 0n) {
    return frac
  }
  if (need <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return `${'0'.repeat(Number(need))}${frac}`
  }
  let out = frac
  while (BigInt(out.length) < totalLen) {
    out = `0${out}`
  }
  return out
}

/**
 * Turns a decimal string in scientific notation into a plain decimal string
 * without floating-point conversion, so mantissa digits beyond ~15 s.d. are kept.
 */
const expandScientificNotationToDecimalString = (s: string): string => {
  const m = SCIENTIFIC_DECIMAL.exec(s.trim())
  if (!m) {
    throw new ChainAmountParseError(`Invalid amount: "${s}"`)
  }

  const signNeg = m[1] === '-'
  let digitStr: string
  let fracLen: number
  if (m[4] !== undefined) {
    digitStr = m[4]
    fracLen = digitStr.length
  } else {
    digitStr = `${m[2] ?? ''}${m[3] ?? ''}`
    fracLen = (m[3] ?? '').length
  }

  if (!/^\d+$/.test(digitStr)) {
    throw new ChainAmountParseError(`Invalid amount: "${s}"`)
  }

  const expStr = m[5] ?? ''
  if (expStr === '' || expStr === '+' || expStr === '-') {
    throw new ChainAmountParseError(`Invalid amount: "${s}"`)
  }

  const allDigits = BigInt(digitStr)
  const exp = BigInt(expStr)
  const scale = exp - BigInt(fracLen)
  const scaleAbs = scale < 0n ? -scale : scale
  if (scaleAbs > MAX_SCALE_ABS) {
    throw new ChainAmountParseError(`Amount exponent out of supported range: "${s}"`)
  }

  let absResult: string
  if (scale >= 0n) {
    const mult = 10n ** scale
    absResult = (allDigits * mult).toString()
  } else {
    const k = -scale
    const divisor = 10n ** k
    const intPart = allDigits / divisor
    const rem = allDigits % divisor
    const frac = padFractionDigits(rem.toString(), k)
    absResult =
      intPart === 0n ? `0.${frac}` : `${intPart.toString()}.${frac}`
  }

  if (signNeg && allDigits !== 0n) {
    return `-${absResult}`
  }
  return absResult
}

export const toChainAmount = (amount: string | number, decimals: number) => {
  if (typeof amount === 'string') {
    const trimmed = amount.trim()
    if (!trimmed) {
      throw new ChainAmountParseError('Amount cannot be empty')
    }
    if (/[eE]/.test(trimmed)) {
      const expanded = expandScientificNotationToDecimalString(trimmed)
      return parseUnits(expanded, decimals)
    }
    return parseUnits(trimmed, decimals)
  }
  const str = amount.toString()
  const value = /[eE]/.test(str) ? amount.toFixed(decimals) : str
  return parseUnits(value, decimals)
}
