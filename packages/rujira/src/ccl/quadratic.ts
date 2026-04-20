// Symmetric weight: w(p) = 1 + σ·(1 - (2·(p - p_m)/Δp)²)
// s-space: w(s²) = C₀ + C₂·s² + C₄·s⁴

import { Ccl } from './base.js'

export class CclQuadratic extends Ccl {
  private c0: number
  private c2: number
  private c4: number

  constructor(high: number, low: number, sigma: number) {
    super(high, low)

    const pM = (high + low) / 2
    const deltaP = high - low

    if (deltaP === 0) {
      this.c0 = 1
      this.c2 = 0
      this.c4 = 0
    } else {
      const dp2 = deltaP * deltaP
      this.c0 = 1 + sigma - (4 * sigma * pM * pM) / dp2
      this.c2 = (8 * sigma * pM) / dp2
      this.c4 = (-4 * sigma) / dp2
    }
  }

  // Y(s) = C₀·(s-s_a) + C₂·(s³-s_a³)/3 + C₄·(s⁵-s_a⁵)/5
  protected yAt(s: number): number {
    const s3 = s * s * s
    const sA3 = this.sA * this.sA * this.sA
    const s5 = s3 * s * s
    const sA5 = sA3 * this.sA * this.sA
    return this.c0 * (s - this.sA) + (this.c2 / 3) * (s3 - sA3) + (this.c4 / 5) * (s5 - sA5)
  }

  // X(s) = C₀·(1/s - 1/s_b) + C₂·(s_b - s) + C₄·(s_b³ - s³)/3
  protected xAt(s: number): number {
    if (s === 0) return 0
    const s3 = s * s * s
    const sB3 = this.sB * this.sB * this.sB
    return this.c0 * (1 / s - 1 / this.sB) + this.c2 * (this.sB - s) + (this.c4 / 3) * (sB3 - s3)
  }

  // Y'(s) = C₀ + C₂·s² + C₄·s⁴
  protected yPrime(s: number): number {
    const s2 = s * s
    return this.c0 + this.c2 * s2 + this.c4 * s2 * s2
  }

  // X'(s) = -C₀/s² - C₂ - C₄·s²
  protected xPrime(s: number): number {
    const s2 = s * s
    if (s2 === 0) return 0
    return -this.c0 / s2 - this.c2 - this.c4 * s2
  }

  weight(p: number): number {
    return this.c0 + this.c2 * p + this.c4 * p * p
  }
}
