/**
 * `sdk.defi.*` — DeFi protocol helpers, including unsigned transaction builders.
 *
 * Builders construct unsigned transactions the wallet/MPC layer can later sign.
 * Some helpers fetch live protocol data or request unsigned transactions from a
 * remote service. Nothing in this surface signs or broadcasts.
 * Affiliate/fee/referral params are always INJECTABLE by the consumer and default
 * to neutral/off — the SDK is multi-consumer and never hardcodes a brand.
 */

import * as arkis from './arkis'
import * as balancer from './balancer'
import * as glif from './glif'
import * as kamino from './kamino'
import * as osmosis from './osmosis'
import { pendle } from './pendle'
import { river } from './river'
import * as stakekitModule from './stakekit'
import * as threeJane from './threeJane'

export { arkis }
export * from './balancer'
export * from './glif'
export * as glif from './glif'
export * as kamino from './kamino'
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
  kamino,
  osmosis,
  pendle,
  river,
  stakekit: stakekitModule.stakekit,
  threeJane,
} as const

export type Defi = typeof defi
