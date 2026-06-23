/**
 * `sdk.defi.*` — DeFi protocol primitives that build UNSIGNED calldata / msgs.
 *
 * Every helper here is a pure builder: it constructs an unsigned transaction the
 * wallet/MPC layer can later sign. Nothing in this surface signs or broadcasts.
 * Affiliate/fee/referral params are always INJECTABLE by the consumer and default
 * to neutral/off — the SDK is multi-consumer and never hardcodes a brand.
 */

import * as balancer from './balancer'

export * from './balancer'

/** Grouped namespace object, exposed as `sdk.defi`. */
export const defi = {
  balancer,
} as const

export type Defi = typeof defi
