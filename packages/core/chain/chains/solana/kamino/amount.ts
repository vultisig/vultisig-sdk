import { kaminoMaxBaseUnits, kaminoMaxDecimals, renderKaminoBaseUnits } from './baseUnits'
import { isPositiveKaminoRate, KaminoRate, parseKaminoRate } from './rate'

/**
 * An amount denominated in a vault's **underlying token** (USDC, SOL).
 *
 * This is what `POST /ktx/kvault/deposit` expects. Deposit and withdraw take
 * the same `amount` JSON field with inverted units — deposit in tokens,
 * withdraw in shares — so the two are separate types on purpose: passing one
 * where the other belongs is a compile error rather than a silently mis-sized
 * transaction. The `unit` discriminant is what makes that hold under
 * structural typing.
 */
export type KaminoTokenAmount = {
  unit: 'kaminoToken'
  /** The exact on-chain integer; every other form is derived from it. */
  baseUnits: bigint
  decimals: number
}

/**
 * An amount denominated in a vault's **share token** (kTokens).
 *
 * This is what `POST /ktx/kvault/withdraw` expects — see `KaminoTokenAmount`
 * for why the units are two distinct types.
 */
export type KaminoShareAmount = {
  unit: 'kaminoShare'
  /** The exact on-chain integer; every other form is derived from it. */
  baseUnits: bigint
  decimals: number
}

/** Either Kamino amount unit; use where behaviour is unit-independent. */
export type KaminoAmount = KaminoTokenAmount | KaminoShareAmount

/** Wraps base units as a token amount. */
export const kaminoTokenAmount = (baseUnits: bigint, decimals: number): KaminoTokenAmount => ({
  unit: 'kaminoToken',
  baseUnits,
  decimals,
})

/** Wraps base units as a share amount. */
export const kaminoShareAmount = (baseUnits: bigint, decimals: number): KaminoShareAmount => ({
  unit: 'kaminoShare',
  baseUnits,
  decimals,
})

/**
 * Parses a base-unit integer string as it appears in vault state (e.g.
 * `minDepositAmount = "100000"` for 0.1 USDC). The caller supplies the scale,
 * because the response never says which of the two mints a figure belongs to.
 */
export const kaminoTokenAmountFromBaseUnitString = (raw: string, decimals: number): KaminoTokenAmount | undefined => {
  const baseUnits = parseBaseUnitString(raw)
  return baseUnits === undefined ? undefined : kaminoTokenAmount(baseUnits, decimals)
}

/**
 * Parses a human-units token decimal string as returned by the metrics
 * endpoint (e.g. `tokensAvailable = "9581.812345"`), exactly, truncating
 * toward zero below the mint's scale.
 */
export const kaminoTokenAmountFromDecimalString = (raw: string, decimals: number): KaminoTokenAmount | undefined => {
  const rate = parseKaminoRate(raw)
  if (!rate) return undefined
  const scaled = scaleKaminoRate({ rate, toDecimals: decimals })
  return scaled === undefined ? undefined : kaminoTokenAmount(scaled.baseUnits, decimals)
}

/**
 * Parses a human-units share decimal string as returned by
 * `GET /kvaults/users/{owner}/positions` (e.g. `"517536.857982"`), exactly,
 * truncating toward zero below the mint's scale.
 */
export const kaminoShareAmountFromDecimalString = (raw: string, decimals: number): KaminoShareAmount | undefined => {
  const rate = parseKaminoRate(raw)
  if (!rate) return undefined
  const scaled = scaleKaminoRate({ rate, toDecimals: decimals })
  return scaled === undefined ? undefined : kaminoShareAmount(scaled.baseUnits, decimals)
}

/**
 * Whether this amount may be sent to Kamino: strictly positive, expressible as
 * a `u64`, and at a sane decimal scale. The API accepts anything it can parse
 * — a below-minimum deposit builds a transaction that fails on-chain, and an
 * over-sized withdraw is rewritten to `u64::MAX`, meaning withdraw everything
 * — so bounds are enforced client-side; this is the only gate the API offers.
 */
export const isValidKaminoRequestAmount = ({ baseUnits, decimals }: KaminoAmount): boolean =>
  baseUnits > 0n && baseUnits <= kaminoMaxBaseUnits && decimals >= 0 && decimals <= kaminoMaxDecimals

/**
 * The value as Kamino's request bodies want it: a plain human-units decimal
 * string with no grouping, no trailing zeros and no exponent.
 */
export const kaminoAmountApiString = ({ baseUnits, decimals }: KaminoAmount): string =>
  renderKaminoBaseUnits({ baseUnits, decimals })

/**
 * Rescales an exact rate to base units at `toDecimals`, truncating toward
 * zero, plus whether anything was truncated away. `undefined` when the scale
 * is implausible or the value negative.
 *
 * The exactness flag exists for one caller and one reason. `/positions`
 * reports share balances at up to 14 decimal places while a share mint has 6,
 * so the truncated figure is *strictly below* the real balance whenever there
 * were extra digits — and exactly equal to it when there were not. The
 * withdraw maximum has to be strictly below, so it needs to know which of the
 * two happened. See `parseKaminoSharePosition`.
 */
export const scaleKaminoRate = ({
  rate,
  toDecimals,
}: {
  rate: KaminoRate
  toDecimals: number
}): { baseUnits: bigint; isExact: boolean } | undefined => {
  if (toDecimals < 0 || toDecimals > kaminoMaxDecimals) return undefined
  if (rate.scale < 0 || rate.scale > kaminoMaxDecimals * 4) return undefined
  if (rate.numerator < 0n) return undefined

  if (toDecimals >= rate.scale) {
    return { baseUnits: rate.numerator * 10n ** BigInt(toDecimals - rate.scale), isExact: true }
  }
  const divisor = 10n ** BigInt(rate.scale - toDecimals)
  return { baseUnits: rate.numerator / divisor, isExact: rate.numerator % divisor === 0n }
}

type ShareToTokenInput = {
  shares: KaminoShareAmount
  /**
   * Underlying tokens per share — `metrics.tokensPerShare`, never
   * `metrics.sharePrice`, which is USD-denominated and only coincides with it
   * on dollar-pegged vaults (Allez SOL: `sharePrice` 0.0794 vs `tokensPerShare`
   * 0.0010749).
   */
  tokensPerShare: KaminoRate
  tokenDecimals: number
}

/**
 * The position's value in the underlying token: `shares × tokensPerShare`,
 * computed in exact integer arithmetic and truncated toward zero.
 */
export const kaminoShareToTokenValue = (input: ShareToTokenInput): KaminoTokenAmount | undefined =>
  shareToToken(input, false)

/**
 * The same conversion rounded **up**.
 *
 * Used for one thing only: rendering a share-denominated *minimum* as an asset
 * amount, so the displayed figure, converted back, still clears the minimum.
 * Never use this to size a transaction: rounding up is exactly the direction
 * that turns a partial withdraw into an over-request.
 */
export const kaminoShareToTokenValueRoundedUp = (input: ShareToTokenInput): KaminoTokenAmount | undefined =>
  shareToToken(input, true)

type TokenToShareInput = {
  tokens: KaminoTokenAmount
  /** Underlying tokens per share — see `ShareToTokenInput.tokensPerShare`. */
  tokensPerShare: KaminoRate
  shareDecimals: number
}

/**
 * Converts a token amount into the share amount a withdraw actually burns:
 * `shares = tokens / tokensPerShare`, truncated toward zero.
 *
 * Exact integer arithmetic, never floating point. Rounding down is a safety
 * property, not a preference: the API does not validate the amount, and a
 * withdraw larger than the user's share balance is silently rewritten to
 * `u64::MAX` — "withdraw everything". A division that rounded up, even by one
 * base unit at the far end of the mantissa, could turn a partial withdraw into
 * a full exit. For the same reason a 100% withdraw must send the held share
 * balance directly and never a number derived from here.
 */
export const kaminoTokenToShareAmount = (input: TokenToShareInput): KaminoShareAmount | undefined =>
  tokenToShare(input, false)

/**
 * The same conversion rounded **up**.
 *
 * Used for one thing only: turning a token-denominated *minimum* into the
 * share count a withdraw has to name to clear it. Rounding down there would
 * produce a share figure worth fractionally less than the minimum, which is
 * the whole bug this exists to avoid. Never use it to size a transaction —
 * see `kaminoTokenToShareAmount` for what an over-request becomes.
 */
export const kaminoTokenToShareAmountRoundedUp = (input: TokenToShareInput): KaminoShareAmount | undefined =>
  tokenToShare(input, true)

const shareToToken = (
  { shares, tokensPerShare, tokenDecimals }: ShareToTokenInput,
  roundUp: boolean
): KaminoTokenAmount | undefined => {
  if (!isConvertible(tokensPerShare, shares.baseUnits, [tokenDecimals, shares.decimals])) return undefined

  // tokens = shares × rate, in base units:
  //   tokensBase = sharesBase × numerator × 10^tokenDecimals
  //                ÷ (10^shareDecimals × 10^rateScale)
  const numerator = shares.baseUnits * tokensPerShare.numerator * 10n ** BigInt(tokenDecimals)
  const denominator = 10n ** BigInt(shares.decimals + tokensPerShare.scale)
  return kaminoTokenAmount(divide(numerator, denominator, roundUp), tokenDecimals)
}

const tokenToShare = (
  { tokens, tokensPerShare, shareDecimals }: TokenToShareInput,
  roundUp: boolean
): KaminoShareAmount | undefined => {
  if (!isConvertible(tokensPerShare, tokens.baseUnits, [shareDecimals, tokens.decimals])) return undefined

  // shares = tokens ÷ rate, in base units:
  //   sharesBase = tokensBase × 10^rateScale × 10^shareDecimals
  //                ÷ (10^tokenDecimals × numerator)
  const numerator = tokens.baseUnits * 10n ** BigInt(tokensPerShare.scale + shareDecimals)
  const denominator = 10n ** BigInt(tokens.decimals) * tokensPerShare.numerator
  return kaminoShareAmount(divide(numerator, denominator, roundUp), shareDecimals)
}

const isConvertible = (rate: KaminoRate, baseUnits: bigint, decimalScales: number[]): boolean =>
  isPositiveKaminoRate(rate) &&
  baseUnits >= 0n &&
  rate.scale >= 0 &&
  rate.scale <= kaminoMaxDecimals * 4 &&
  decimalScales.every(decimals => decimals >= 0 && decimals <= kaminoMaxDecimals)

const divide = (numerator: bigint, denominator: bigint, roundUp: boolean): bigint =>
  roundUp ? (numerator + denominator - 1n) / denominator : numerator / denominator

const parseBaseUnitString = (raw: string): bigint | undefined => {
  if (!/^-?\d+$/.test(raw)) return undefined
  return BigInt(raw)
}
