// DeFi protocol integrations under the sdk.defi.* surface.
// Each protocol builds UNSIGNED calldata only — it never signs or broadcasts.
import * as threeJane from './threeJane'

/** Aggregated `sdk.defi.*` namespace. */
export const defi = {
  threeJane,
} as const

export * as threeJane from './threeJane'
