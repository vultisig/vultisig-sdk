// Linear weight: w(p) = 1 + σ·(p - p_m)/Δp
// Coefficients: β = σ/Δp, α = 1 - β·p_m

import { Ccl } from './base.js'

export class CclLinear extends Ccl {
  private alpha: number
  private beta: number

  constructor(high: number, low: number, sigma: number) {
    super(high, low)

    const pM = (high + low) / 2
    const deltaP = high - low

    if (deltaP === 0) {
      this.beta = 0
      this.alpha = 1
    } else {
      this.beta = sigma / deltaP
      this.alpha = 1 - this.beta * pM
    }
  }

  // Y(s) = α·(s - s_a) + (β/3)·(s³ - s_a³)
  protected yAt(s: number): number {
    const diff = s - this.sA
    const sCubed = s * s * s
    const sACubed = this.sA * this.sA * this.sA
    return this.alpha * diff + (this.beta / 3) * (sCubed - sACubed)
  }

  // X(s) = (s_b - s)·(α/(s·s_b) + β)
  protected xAt(s: number): number {
    const diff = this.sB - s
    const denom = s * this.sB
    if (denom === 0) return 0
    return diff * (this.alpha / denom + this.beta)
  }

  // Y'(s) = α + β·s²
  protected yPrime(s: number): number {
    return this.alpha + this.beta * s * s
  }

  // X'(s) = -α/s² - β
  protected xPrime(s: number): number {
    const s2 = s * s
    if (s2 === 0) return 0
    return -this.alpha / s2 - this.beta
  }

  weight(p: number): number {
    return this.alpha + this.beta * p
  }
}
