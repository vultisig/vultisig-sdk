// sdk.defi.* — DeFi protocol primitives that BUILD UNSIGNED txs/calldata only.
//
// Every surface here is pure crypto: it constructs unsigned transactions (or
// reads protocol state) and NEVER signs or broadcasts. The consumer gates
// signing. Any affiliate/fee param is INJECTABLE by the consumer (default
// neutral/off) — the SDK is multi-consumer and never hardcodes a referral.
//
// First protocol: Pendle (PT buy/sell/redeem) — see ./pendle.

import { pendle } from './pendle'

export * from './pendle'

/** The aggregated sdk.defi namespace. */
export const defi = {
  pendle,
} as const
