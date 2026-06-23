// sdk.defi.* — DeFi protocol primitives that BUILD UNSIGNED calldata/msgs only.
//
// Each protocol lives under its own namespace (`sdk.defi.<protocol>`). The
// surface is multi-consumer: any affiliate/fee param is injectable by the
// caller and defaults to neutral/off — no consumer identity is ever hardcoded.
import * as arkis from './arkis'

export { arkis }

/** Grouped DeFi namespace exposed as `sdk.defi`. */
export const defi = {
  arkis,
} as const

export type Defi = typeof defi
