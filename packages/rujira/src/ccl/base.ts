import { RujiraError, RujiraErrorCode } from '../errors.js'

const NEWTON_ITERATIONS = 6

export abstract class Ccl {
  readonly high: number
  readonly low: number
  protected sA: number
  protected sB: number

  constructor(high: number, low: number) {
    if (!Number.isFinite(high) || !Number.isFinite(low) || low < 0 || high < low) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_PARAMS,
        `CCL range bounds must be finite and satisfy 0 <= low <= high (got high=${high}, low=${low})`
      )
    }
    this.high = high
    this.low = low
    this.sA = Math.sqrt(low)
    this.sB = Math.sqrt(high)
  }

  protected abstract yAt(s: number): number
  protected abstract xAt(s: number): number
  protected abstract yPrime(s: number): number
  protected abstract xPrime(s: number): number
  abstract weight(p: number): number

  // Newton-Raphson: solve F(s) = x·Y(s) - y·X(s) = 0
  price(base: number, quote: number): number {
    // Reject non-finite / negative inputs up front so a bad parsed
    // number from upstream (NaN from a failed parseFloat, or an
    // Infinity from a bogus scaling) can't propagate through the
    // solver and produce a NaN price. Exported helpers MUST fail
    // loudly on invalid inputs — silent NaN is worse than a throw.
    if (!Number.isFinite(base) || !Number.isFinite(quote) || base < 0 || quote < 0) {
      throw new RujiraError(
        RujiraErrorCode.INVALID_PARAMS,
        `price() requires finite non-negative base/quote (got base=${base}, quote=${quote})`
      )
    }
    if (quote === 0) return this.sA * this.sA
    if (base === 0) return this.sB * this.sB

    let s = Math.sqrt(this.sA * this.sB)

    for (let i = 0; i < NEWTON_ITERATIONS; i++) {
      const f = base * this.yAt(s) - quote * this.xAt(s)
      const fPrime = base * this.yPrime(s) - quote * this.xPrime(s)

      if (fPrime === 0) break

      const delta = f / fPrime
      if (delta < 0) {
        s = s + Math.abs(delta)
      } else if (Math.abs(delta) > s) {
        s = this.sA
      } else {
        s = s - Math.abs(delta)
      }

      s = Math.max(this.sA, Math.min(this.sB, s))
    }

    return s * s
  }

  ask(price: number, spread: number): number {
    return price + (price * spread) / 2
  }

  bid(price: number, spread: number): number {
    return Math.max(0, price - (price * spread) / 2)
  }

  balanceRatio(price: number): number | null {
    const s = Math.sqrt(price)
    const xS = this.xAt(s)
    if (xS === 0) return null
    return this.yAt(s) / xS
  }
}
