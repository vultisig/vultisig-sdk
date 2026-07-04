/**
 * `sdk.defi.*` — DeFi protocol primitives that build UNSIGNED calldata / msgs.
 *
 * Every helper here is a pure builder: it constructs an unsigned transaction the
 * wallet/MPC layer can later sign. Nothing in this surface signs or broadcasts.
 * Affiliate/fee/referral params are always INJECTABLE by the consumer and default
 * to neutral/off — the SDK is multi-consumer and never hardcodes a brand.
 */

import * as arkis from './arkis'
import * as balancer from './balancer'
import * as glif from './glif'
import * as osmosis from './osmosis'
import { pendle } from './pendle'
import { river } from './river'
import * as stakekitModule from './stakekit'
import * as threeJane from './threeJane'

export { arkis }
export * from './balancer'
export * from './glif'
export * as glif from './glif'
export * as osmosis from './osmosis'
export * from './pendle'
export * from './river'
export * from './stakekit'
export * as threeJane from './threeJane'

/** Grouped namespace object, exposed as `sdk.defi`. */
export const defi = {
  arkis,
  balancer,
  glif,
  osmosis,
  pendle,
  river,
  stakekit: stakekitModule.stakekit,
  threeJane,
} as const

export type Defi = typeof defi
