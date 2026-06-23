/**
 * `sdk.defi.*` — DeFi protocol primitives that build UNSIGNED calldata / msgs.
 *
 * Every helper here is a pure builder: it constructs an unsigned transaction the
 * wallet/MPC layer can later sign. Nothing in this surface signs or broadcasts.
 * Affiliate/fee/referral params are always INJECTABLE by the consumer and default
 * to neutral/off — the SDK is multi-consumer and never hardcodes a brand.
 */

import * as balancer from './balancer'
import * as threeJane from './threeJane'

export * from './balancer'
export * as threeJane from './threeJane'

/** Grouped namespace object, exposed as `sdk.defi`. */
export const defi = {
  balancer,
  threeJane,
} as const

export type Defi = typeof defi
