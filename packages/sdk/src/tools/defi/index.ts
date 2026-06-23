// sdk.defi.* — DeFi protocol primitives that BUILD UNSIGNED txs/calldata only.
//
// Every surface here is pure crypto: it constructs unsigned transactions (or
// reads protocol state) and NEVER signs or broadcasts. The consumer gates
// signing. Any affiliate/fee param is INJECTABLE by the consumer (default
// neutral/off) — the SDK is multi-consumer and never hardcodes a referral.

import { pendle } from './pendle'
import * as threeJane from './threeJane'

export * from './pendle'
export * as threeJane from './threeJane'

/** The aggregated sdk.defi namespace. */
export const defi = {
  pendle,
  threeJane,
} as const
