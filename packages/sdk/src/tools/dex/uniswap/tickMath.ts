/**
 * Uniswap V3 tick math — bidirectional tick <-> sqrtPriceX96 <-> human-price
 * conversion. Pure functions, no network calls, no signing, no broadcast.
 *
 * Ported from vultisig/mcp-ts `src/tools/uniswap/tick-math.ts` (itself a port
 * of `mcp/internal/tools/uniswap_v3_tick_math.go`) into the SDK as a reusable
 * DEX primitive. We use JS `number` for the tick since its int24 range fits;
 * sqrtPriceX96 and Q96 stay as bigint so the fixed-point math doesn't lose
 * precision.
 *
 * Part of the mcp-ts/backend → SDK code-as-action consolidation.
 */

const Q96 = 2n ** 96n
const Q192 = Q96 * Q96

/**
 * Fee tier (hundredths of a bip) → tick spacing. Canonical Uniswap V3 mapping.
 */
export const UNI_V3_TICK_SPACING: Record<number, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
}

/**
 * PRICE_SCALE=80 keeps ≥18 sig figs across the full V3 tick range
 * [-887272, 887272]. Min-tick prices (~2.94e-39) need ≥57 decimals just to
 * carry 18 sig figs; 80 gives ~38 digits of headroom past that floor before
 * the mantissa underflows to zero — covering decimal-skew up to ~36 digits.
 */
const PRICE_SCALE = 80

/**
 * sqrtPriceX96 -> price-as-bigint scaled by 10^scale. Keeps full precision (no
 * Number conversion). Returns { mantissa, scale } where
 * actual_price = mantissa / 10^scale.
 */
export function sqrtPriceToPriceMantissa(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number
): { mantissa: bigint; scale: number } {
  if (sqrtPriceX96 === 0n) return { mantissa: 0n, scale: 0 }
  // priceRatio (token0 in token1) = sqrtP^2 / 2^192, scaled up by 10^PRICE_SCALE
  // for fixed-point precision. Apply decimals shift by adjusting `scale`:
  //   real_price = mantissa / 10^(PRICE_SCALE - (decimals0 - decimals1))
  const SCALE = 10n ** BigInt(PRICE_SCALE)
  const numerator = sqrtPriceX96 * sqrtPriceX96 * SCALE
  const mantissa = numerator / Q192
  const decDiff = decimals0 - decimals1
  return { mantissa, scale: PRICE_SCALE - decDiff }
}

/**
 * sqrtPriceX96 -> human price as a JS number (lossy, ~16 sig figs). Kept for
 * in-process consumers (price comparisons, range checks). For wire-shape
 * responses use formatPrice18 against the BigInt mantissa.
 */
export function sqrtPriceToPrice(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const { mantissa, scale } = sqrtPriceToPriceMantissa(sqrtPriceX96, decimals0, decimals1)
  if (mantissa === 0n) return 0
  return Number(mantissa) / Math.pow(10, scale)
}

/**
 * Format a BigInt-backed price (mantissa / 10^scale) as an 18-significant-digit
 * string in Go's `big.Float.Text('g', 18)` shape: pure decimal when the
 * exponent is in [-4, 18), exponential otherwise. Trailing fractional zeros are
 * stripped. Uses round-half-to-even (banker's rounding) to match Go's default.
 */
export function formatPrice18(mantissa: bigint, scale: number): string {
  if (mantissa === 0n) return '0'
  const negative = mantissa < 0n
  const abs = negative ? -mantissa : mantissa
  const sign = negative ? '-' : ''

  const digits = abs.toString()
  const expBase = digits.length - 1 - scale

  const SIG = 18
  let sig: string
  if (digits.length <= SIG) {
    sig = digits.padEnd(SIG, '0')
  } else {
    const head = digits.substring(0, SIG)
    const roundDigit = digits.charCodeAt(SIG) - 48
    let shouldRoundUp: boolean
    if (roundDigit > 5) {
      shouldRoundUp = true
    } else if (roundDigit < 5) {
      shouldRoundUp = false
    } else {
      const tail = digits.substring(SIG + 1)
      const hasNonZeroTail = /[1-9]/.test(tail)
      if (hasNonZeroTail) {
        shouldRoundUp = true
      } else {
        const lastKeeper = head.charCodeAt(SIG - 1) - 48
        shouldRoundUp = lastKeeper % 2 === 1
      }
    }
    if (shouldRoundUp) {
      const headDigits = head.split('').map(d => Number(d))
      let i = SIG - 1
      while (i >= 0) {
        if (headDigits[i]! < 9) {
          headDigits[i]! += 1
          break
        }
        headDigits[i] = 0
        i--
      }
      if (i < 0) {
        // Carry past leading digit: 999...9 → 1000...0, exponent shifts up by 1
        sig = '1' + '0'.repeat(SIG - 1)
        return formatGSig(sig, expBase + 1, sign)
      }
      sig = headDigits.join('')
    } else {
      sig = head
    }
  }
  return formatGSig(sig, expBase, sign)
}

function formatGSig(sig: string, expBase: number, sign: string): string {
  const trimmed = sig.replace(/0+$/, '') || '0'
  if (expBase >= -4 && expBase < 18) {
    if (expBase >= trimmed.length - 1) {
      return sign + trimmed + '0'.repeat(expBase - trimmed.length + 1)
    }
    if (expBase >= 0) {
      const intPart = trimmed.substring(0, expBase + 1)
      const fracPart = trimmed.substring(expBase + 1)
      return sign + intPart + (fracPart ? '.' + fracPart : '')
    }
    const leadingZeros = '0'.repeat(-expBase - 1)
    return sign + '0.' + leadingZeros + trimmed
  }
  const head = trimmed[0] ?? '0'
  const tail = trimmed.substring(1)
  const expStr = expBase >= 0 ? `+${expBase}` : `${expBase}`
  return sign + head + (tail ? '.' + tail : '') + 'e' + expStr
}

/**
 * tick -> price.  price = 1.0001^tick * 10^(decimals0 - decimals1)
 *
 * Pure Math.pow is accurate enough for display (~12 sig figs); for full
 * 18-sig-fig precision use tickToPriceMantissa (canonical sqrtPriceX96 path).
 */
export function tickToPrice(tick: number, decimals0: number, decimals1: number): number {
  const raw = Math.pow(1.0001, tick)
  const decDiff = decimals0 - decimals1
  return decDiff === 0 ? raw : raw * Math.pow(10, decDiff)
}

/**
 * Range check matches Solidity: |tick| ≤ MAX_TICK = 887272.
 * Source: https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol
 */
export const MAX_TICK = 887272

/**
 * tick -> sqrtPriceX96 via Uniswap V3's canonical TickMath.getSqrtRatioAtTick.
 *
 * The 19 magic constants are 1.0001^(2^k) at Q128.128 fixed-point, used by
 * every conforming pool on-chain. Binary exponentiation in BigInt makes the
 * result bit-identical to what the contract would store at this tick.
 */
export function getSqrtRatioAtTick(tick: number): bigint {
  const absTick = tick < 0 ? -tick : tick
  if (absTick > MAX_TICK) {
    throw new Error(`tick ${tick} out of range [-${MAX_TICK}, ${MAX_TICK}]`)
  }

  let ratio: bigint = (absTick & 0x1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n

  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n

  if (tick > 0) {
    // type(uint256).max / ratio
    ratio = ((1n << 256n) - 1n) / ratio
  }

  // Convert from Q128.128 to Q128.96 (i.e. >> 32), rounding up
  const remainder = ratio % (1n << 32n)
  return (ratio >> 32n) + (remainder === 0n ? 0n : 1n)
}

/**
 * tick -> price mantissa via the canonical sqrtPriceX96 path. Result has ≥18
 * sig figs across the V3 tick range and matches on-chain pool state at the tick.
 */
export function tickToPriceMantissa(
  tick: number,
  decimals0: number,
  decimals1: number
): { mantissa: bigint; scale: number } {
  const sqrtP = getSqrtRatioAtTick(tick)
  return sqrtPriceToPriceMantissa(sqrtP, decimals0, decimals1)
}

/**
 * price -> tick.  tick = floor(log(price / 10^(decimals0-decimals1)) / log(1.0001))
 */
export function priceToTick(price: number, decimals0: number, decimals1: number): number {
  if (!(price > 0) || !Number.isFinite(price)) {
    throw new Error(`invalid price: must be a positive finite number, got ${price}`)
  }
  const decDiff = decimals0 - decimals1
  const adjusted = decDiff === 0 ? price : price / Math.pow(10, decDiff)
  if (!(adjusted > 0) || !Number.isFinite(adjusted)) {
    throw new Error(`invalid price: adjusted value underflowed or is non-finite, got ${adjusted}`)
  }
  return Math.floor(Math.log(adjusted) / Math.log(1.0001))
}

/** Round a tick down to the nearest valid multiple of `spacing`. */
export function roundTickDown(tick: number, spacing: number): number {
  const mod = ((tick % spacing) + spacing) % spacing
  return tick - mod
}

/** Round a tick up to the nearest valid multiple of `spacing`. */
export function roundTickUp(tick: number, spacing: number): number {
  if (tick % spacing === 0) return tick
  return roundTickDown(tick, spacing) + spacing
}
