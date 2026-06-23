/**
 * `sdk.defi.*` — DeFi protocol primitives.
 *
 * Each protocol lives under `sdk.defi.<protocol>` and builds UNSIGNED txs/msgs
 * only (never signs/broadcasts). Part of the sdk.defi.* DeFi consolidation.
 */

export * from './river'
import { river } from './river'

/** Grouped namespace: `defi.river.*`. */
export const defi = {
  river,
} as const
