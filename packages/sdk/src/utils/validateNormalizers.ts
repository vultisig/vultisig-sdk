/**
 * Pure-crypto chain-math normalizers ported from the agent-backend validator
 * (internal/service/agent/validator/{decimals,amount,fee,token_symbol}.go).
 *
 * These are the PURE primitives only — base-unit <-> human scaling, exact
 * relative-tolerance amount comparison, EVM gas-fee computation, and
 * token-symbol FORMAT validation + a canonical token-decimals registry.
 *
 * The agent-judgement layer (response regex-scraping, grounding a claimed
 * value against tool results, fabricated-vs-grounded discrepancy scoring,
 * severity-by-signing-surface) intentionally STAYS in the agent backend.
 * Nothing here signs, broadcasts, or fetches.
 *
 * All math is exact BigInt fixed-point — decimals is right or wrong, not
 * noisy, so we never round-trip through float64 the way `fromChainAmount`
 * does. Mirrors the Go `math/big` path.
 */
import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'

/** Thrown when an input to a normalizer is malformed. Message is LLM-readable. */
export class ValidateNormalizerError extends Error {
  override readonly name = 'ValidateNormalizerError'

  constructor(message: string) {
    super(message)
  }
}

// ============================================================================
// Token-decimals registry (ported from amount.go tokenDecimals + nativeForChain)
// ============================================================================

/**
 * Per-ticker scaling table. Flat — no per-chain variants (a native ticker has
 * one canonical decimals across the chains we support). Uppercase keys.
 *
 * Conservative by design: a missing entry means a caller must pass decimals
 * explicitly rather than silently guessing. Ported verbatim from the Go
 * `tokenDecimals` map so the SDK and backend agree on the same scale.
 */
export const tokenDecimals: Readonly<Record<string, number>> = Object.freeze({
  // Native / gas tokens.
  ETH: 18,
  BNB: 18,
  POL: 18,
  MATIC: 18,
  AVAX: 18,
  SEI: 18,
  VULT: 18,
  FTM: 18,
  DAI: 18,
  WETH: 18,
  ZK: 18,
  // Stables (18-dec unless noted).
  USDC: 6,
  USDT: 6,
  USDC0: 6,
  USDE: 18,
  PYUSD: 6,
  GUSD: 2,
  TUSD: 18,
  FRAX: 18,
  LUSD: 18,
  // BTC-family and UTXO.
  WBTC: 8,
  BTC: 8,
  LTC: 8,
  DOGE: 8,
  BCH: 8,
  DASH: 8,
  ZEC: 8,
  // Alt-L1.
  SOL: 9,
  SUI: 9,
  TON: 9,
  XRP: 6,
  ATOM: 6,
  OSMO: 6,
  KUJI: 6,
  TRX: 6,
  ADA: 6,
  DOT: 10,
  RUNE: 8,
  CACAO: 10,
  TCY: 8,
  RUJI: 8,
  // Popular 18-dec ERC20s (Ethereum + L2 flavors).
  LINK: 18,
  AAVE: 18,
  ARB: 18,
  OP: 18,
  UNI: 18,
  CRV: 18,
  LDO: 18,
  MKR: 18,
  GRT: 18,
  SNX: 18,
  BAL: 18,
  COMP: 18,
  YFI: 18,
  SUSHI: 18,
  '1INCH': 18,
  ENS: 18,
  SHIB: 18,
  PEPE: 18,
  APE: 18,
  BLUR: 18,
})

/**
 * Returns the canonical decimals for a known ticker (case-insensitive) or
 * `undefined` when the symbol is not in the registry. Mirrors Go `decimalsFor`.
 */
export const decimalsFor = (symbol: string): number | undefined => tokenDecimals[symbol.trim().toUpperCase()]

// ============================================================================
// Decimals / amount scaling (ported from decimals.go scaleRawToHuman + amount.go)
// ============================================================================

const pow10 = (n: number): bigint => {
  if (!Number.isInteger(n) || n < 0 || n > 1000) {
    throw new ValidateNormalizerError(`Invalid decimals "${n}" — must be an integer in [0, 1000].`)
  }
  return 10n ** BigInt(n)
}

const parseRawBigInt = (raw: bigint | string): bigint => {
  if (typeof raw === 'bigint') return raw
  const trimmed = raw.trim()
  if (!/^-?\d+$/.test(trimmed)) {
    throw new ValidateNormalizerError(`Invalid base-unit amount "${raw}" — expected an integer string.`)
  }
  return BigInt(trimmed)
}

/**
 * Scale a base-unit (raw integer) amount to a human-readable decimal string by
 * dividing by 10^decimals. EXACT — no float round-trip. Mirrors Go
 * `scaleRawToHuman` + `formatBigFloat` (trailing zeros trimmed).
 *
 * @example scaleRawToHuman('220208030381', 10) // "22.0208030381"
 * @example scaleRawToHuman('1000000', 6)        // "1"
 */
export const scaleRawToHuman = (raw: bigint | string, decimals: number): string => {
  const value = parseRawBigInt(raw)
  const scale = pow10(decimals)
  const neg = value < 0n
  const abs = neg ? -value : value
  const whole = abs / scale
  const frac = abs % scale
  let out: string
  if (frac === 0n) {
    out = whole.toString()
  } else {
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
    out = `${whole.toString()}.${fracStr}`
  }
  return neg && abs !== 0n ? `-${out}` : out
}

/**
 * Inverse of {@link scaleRawToHuman}: scale a human decimal amount up to
 * base units (raw integer) at `decimals`. EXACT — fail-closed on any input
 * that cannot be represented losslessly at `decimals`.
 *
 * Expansion goes through the SDK's viem-backed `toChainAmount` (so scientific
 * notation is handled the same way every other SDK path handles it), but
 * because `parseUnits` silently ROUNDS sub-`decimals` precision (e.g.
 * `'1.9999999' @ 6 -> 2000000`, `'0.0000000000000000001' @ 18 -> 0`), a
 * validator/grounding primitive must NOT accept that coercion: rounding a
 * claimed amount up by a unit — or dropping a non-zero sub-unit to zero —
 * fabricates the number a fund decision is made on. We inspect the input's
 * plain decimal expansion and reject any significant fractional digit past
 * position `decimals`, which catches both the round-up and drop cases
 * regardless of notation, at every decimals incl. 18.
 *
 * @throws {ValidateNormalizerError} when the input is malformed OR carries
 *   sub-base-unit precision that cannot be represented exactly at `decimals`.
 * @example scaleHumanToRaw('22.0208030381', 10) // 220208030381n
 */
export const scaleHumanToRaw = (human: string | number, decimals: number): bigint => {
  pow10(decimals) // validate decimals range
  let raw: bigint
  try {
    raw = toChainAmount(human, decimals)
  } catch (error) {
    throw new ValidateNormalizerError(
      `Could not scale "${human}" to base units at decimals=${decimals}: ${(error as Error).message}`
    )
  }
  // Fail-closed on lossy coercion. `parseUnits` silently rounds any fractional
  // digit beyond `decimals`, so reject inputs that carry sub-base-unit
  // precision. Inspect the *plain* decimal expansion (scientific notation is
  // expanded first) and require zero significant digits past position
  // `decimals` in the fractional part — exact at every decimals incl. 18.
  const plain = expandToPlainDecimal(human)
  const dot = plain.indexOf('.')
  if (dot !== -1) {
    const fracDigits = plain.slice(dot + 1).replace(/0+$/, '')
    if (fracDigits.length > decimals) {
      throw new ValidateNormalizerError(
        `Amount "${human}" carries sub-base-unit precision that cannot be represented exactly at decimals=${decimals}.`
      )
    }
  }
  return raw
}

/**
 * Expand a decimal string (optionally in scientific notation) to a plain
 * decimal string WITHOUT float conversion, so digits beyond ~15 s.d. survive.
 * Used to count sub-base-unit precision exactly. Returns a normalized string
 * with no exponent. Throws {@link ValidateNormalizerError} on malformed input.
 */
const expandToPlainDecimal = (value: string | number): string => {
  const str = (typeof value === 'number' ? value.toString() : value).trim()
  if (str === '') throw new ValidateNormalizerError('Empty amount.')
  if (!/[eE]/.test(str)) {
    if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(str)) {
      throw new ValidateNormalizerError(`Invalid amount "${value}".`)
    }
    return str
  }
  const m = /^([+-]?)(?:(\d+)\.?(\d*)|\.(\d+))[eE]([+-]?\d+)$/.exec(str)
  if (!m) throw new ValidateNormalizerError(`Invalid amount "${value}".`)
  const sign = m[1] === '-' ? '-' : ''
  const digits = m[4] !== undefined ? m[4] : `${m[2] ?? ''}${m[3] ?? ''}`
  const fracLen = m[4] !== undefined ? m[4].length : (m[3] ?? '').length
  const exp = Number(m[5])
  const shift = exp - fracLen // net power-of-ten applied to the integer `digits`
  const intDigits = digits.replace(/^0+(?=\d)/, '')
  if (shift >= 0) {
    return `${sign}${intDigits}${'0'.repeat(shift)}`
  }
  const k = -shift
  const padded = intDigits.padStart(k + 1, '0')
  const whole = padded.slice(0, padded.length - k)
  const frac = padded.slice(padded.length - k)
  return `${sign}${whole}.${frac}`
}

const SCALE = 1_000_000_000_000_000_000n // 1e18 fixed-point scale for ratios

const parseHumanToScaled = (value: string | number): { num: bigint; neg: boolean } => {
  const str = typeof value === 'number' ? value.toString() : value.trim()
  if (str === '') throw new ValidateNormalizerError('Empty amount.')
  if (/[eE]/.test(str)) {
    // Expand scientific notation losslessly via toChainAmount at 18 dp.
    const raw = toChainAmount(str, 18)
    return { num: raw < 0n ? -raw : raw, neg: raw < 0n }
  }
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(str)
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
    throw new ValidateNormalizerError(`Invalid amount "${value}".`)
  }
  const neg = m[1] === '-'
  const whole = m[2] === '' ? 0n : BigInt(m[2])
  const frac = (m[3] ?? '').slice(0, 18).padEnd(18, '0')
  const num = whole * SCALE + (frac === '' ? 0n : BigInt(frac))
  return { num, neg }
}

/**
 * Returns true if `claim` and `expected` (human decimal amounts) agree within
 * `tolerance` (relative to expected). Exact BigInt comparison at 1e-18
 * resolution — mirrors Go `amountMatches`, including the 1e-18 absolute floor
 * so a zero/near-zero expected still has a usable bound.
 *
 * Tolerance is a fraction: 0.01 == 1%, 0 == exact. Sign-aware (compares
 * absolute difference against an absolute bound).
 *
 * @example amountMatches('22.02', '22.0208030381', 0.01) // true  (~0.004% off)
 * @example amountMatches('0.000220208', '22.02', 0.01)   // false (off by 1e5)
 */
export const amountMatches = (claim: string | number, expected: string | number, tolerance: number): boolean => {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new ValidateNormalizerError(`Invalid tolerance "${tolerance}" — must be a finite number >= 0.`)
  }
  const c = parseHumanToScaled(claim)
  const e = parseHumanToScaled(expected)
  const claimNum = c.neg ? -c.num : c.num
  const expNum = e.neg ? -e.num : e.num
  let diff = claimNum - expNum
  if (diff < 0n) diff = -diff
  let expAbs = expNum
  if (expAbs < 0n) expAbs = -expAbs
  // bound = expAbs * tolerance, scaled. tolerance is a JS float; render to a
  // ppm-style integer at 1e9 resolution then divide back to keep it exact-ish.
  const tolScaled = BigInt(Math.round(tolerance * 1e9))
  let bound = (expAbs * tolScaled) / 1_000_000_000n
  const floor = 1n // 1e-18 absolute floor (1 unit at 1e18 scale)
  if (bound < floor) bound = floor
  return diff <= bound
}

// ============================================================================
// EVM fee computation (ported from fee.go computeFee18Decimals)
// ============================================================================

/**
 * Compute an EVM transaction fee in the native coin (18-decimal) as a
 * human-readable string: `gasLimit * maxFeePerGas / 1e18`. Exact BigInt
 * multiply (max_fee_per_gas overflows 64-bit on gas spikes). Mirrors Go
 * `computeFee18Decimals`.
 *
 * @param gasLimit       gas units (integer string or bigint)
 * @param maxFeePerGas   wei per gas unit (integer string or bigint)
 * @returns human-readable native-coin fee, e.g. "0.000315"
 *
 * @example computeEvmFee(21000n, 15000000000n) // "0.000315" (21000 * 15 gwei)
 */
export const computeEvmFee = (gasLimit: bigint | string, maxFeePerGas: bigint | string): string => {
  const gl = parseRawBigInt(gasLimit)
  const mf = parseRawBigInt(maxFeePerGas)
  if (gl < 0n || mf < 0n) {
    throw new ValidateNormalizerError('gasLimit and maxFeePerGas must be non-negative.')
  }
  const wei = gl * mf
  return scaleRawToHuman(wei, 18)
}

/**
 * Returns true if a claimed EVM fee (human native-coin amount) is within
 * `tolerance` of the fee computed from `gasLimit * maxFeePerGas`. Default 5%
 * tolerance matches the Go fee extractor's grounding bound.
 *
 * @example feeMatches('0.000315', 21000n, 15000000000n) // true
 */
export const feeMatches = (
  claimedFee: string | number,
  gasLimit: bigint | string,
  maxFeePerGas: bigint | string,
  tolerance = 0.05
): boolean => amountMatches(claimedFee, computeEvmFee(gasLimit, maxFeePerGas), tolerance)

// ============================================================================
// Token-symbol FORMAT validation (ported from token_symbol.go shape rules)
// ============================================================================

// Canonical on-chain ticker shape: 3-10 chars, starts with a LETTER, then
// letters + digits, optional ".suffix" (e.g. USDC.e) or "/pair" (e.g.
// RUJI/RUNE). This is the pure FORMAT predicate — it does NOT decide whether
// the symbol is real / grounded (that is the agent layer's job against tool
// results).
//
// Mirrors the Go `symbolCandidateRe` shape EXACTLY (anchored here, \b-bounded
// there): `[A-Z][A-Z0-9]{2,9}` base/pair — uppercase-only, min length 3 — with
// the same `[a-zA-Z]{1,4}` dotted suffix. The Go matcher never lowercases the
// candidate before matching (it only ToUppers for the allowlist compare), so a
// lowercase or 2-char input does NOT match upstream; we reproduce that by
// upper-casing in the callers below before testing, which keeps the SDK's
// case-insensitive ergonomics (usdc.e -> USDC.E) while rejecting the same 2-char
// tickers (OP, ZK) the backend rejects. Previously this was `[A-Za-z][...]{1,9}`
// which accepted 2-char + lowercase tickers the Go side drops — drift fixed.
const SYMBOL_SHAPE = /^[A-Z][A-Z0-9]{2,9}(?:\.[a-zA-Z]{1,4})?(?:\/[A-Z][A-Z0-9]{2,9}(?:\.[a-zA-Z]{1,4})?)?$/

/**
 * Returns true if `symbol` matches the canonical token-ticker FORMAT (length,
 * charset, optional dotted-suffix or slash-pair). Pure shape check — does not
 * assert the token exists. Mirrors the Go `symbolCandidateRe` shape, anchored.
 *
 * Input is upper-cased before the shape test so the case-insensitive SDK
 * ergonomics hold while the underlying pattern stays uppercase-only (matching
 * the Go regex, which only ever sees uppercase candidates in practice).
 */
export const isValidTokenSymbolFormat = (symbol: string): boolean =>
  typeof symbol === 'string' && SYMBOL_SHAPE.test(symbol.trim().toUpperCase())

/**
 * Normalize a token symbol to its canonical uppercase form after validating
 * the FORMAT. Splits a slash-pair into its component tickers (uppercased).
 *
 * @throws {ValidateNormalizerError} when the input is not a valid symbol shape.
 * @returns the uppercased symbol, plus `parts` for slash-pairs.
 *
 * @example normalizeTokenSymbol('usdc.e')      // { symbol: 'USDC.E', parts: ['USDC.E'] }
 * @example normalizeTokenSymbol('ruji/rune')   // { symbol: 'RUJI/RUNE', parts: ['RUJI','RUNE'] }
 */
export const normalizeTokenSymbol = (symbol: string): { symbol: string; parts: string[] } => {
  const trimmed = typeof symbol === 'string' ? symbol.trim() : ''
  if (!isValidTokenSymbolFormat(trimmed)) {
    throw new ValidateNormalizerError(`Invalid token symbol format "${symbol}".`)
  }
  const upper = trimmed.toUpperCase()
  return { symbol: upper, parts: upper.split('/') }
}
