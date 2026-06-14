import { Chain } from '@vultisig/core-chain/Chain'

/**
 * App-wide, per-chain custom RPC endpoint overrides.
 *
 * The persisted source of truth lives in the host app (desktop + extension
 * storage). This module is the in-memory mirror the networking layer reads
 * from: the EVM / Cosmos URL resolvers build their clients off the main thread
 * via *synchronous, non-async* lookups and cannot await storage, so the host
 * hydrates this map at launch and keeps it in sync on every write.
 *
 * `undefined` from {@link getCustomRpcOverride} means "no override", and the
 * caller keeps its hardcoded default — guaranteeing byte-identical default
 * behaviour for users who never configured one.
 *
 * Keyed by the raw `string` chain id (which `Chain` already is) so reads/writes
 * stay assertion-free.
 */
const overridesByChain = new Map<string, string>()

// Trims surrounding whitespace and treats a blank URL as "no override", so an
// empty string can never become an active override that breaks RPC resolution.
const normalizeOverrideUrl = (url: string): string | undefined => {
  const trimmed = url.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Synchronous lookup of the override URL for `chain`, or `undefined` when unset. */
export const getCustomRpcOverride = (chain: Chain): string | undefined => overridesByChain.get(chain)

/** Persist a single override into the in-memory mirror. A blank URL clears it. */
export const setCustomRpcOverride = (chain: Chain, url: string): void => {
  const normalized = normalizeOverrideUrl(url)
  if (normalized) {
    overridesByChain.set(chain, normalized)
  } else {
    overridesByChain.delete(chain)
  }
}

/** Remove a single override from the in-memory mirror. */
export const clearCustomRpcOverride = (chain: Chain): void => {
  overridesByChain.delete(chain)
}

/**
 * Replace the entire override map. Used by the host app to hydrate the mirror
 * from persisted storage at launch and after each write, so the networking
 * layer always reflects the latest persisted state.
 */
export const setCustomRpcOverrides = (overrides: Partial<Record<Chain, string>>): void => {
  overridesByChain.clear()
  for (const [chain, url] of Object.entries(overrides)) {
    if (typeof url === 'string') {
      const normalized = normalizeOverrideUrl(url)
      if (normalized) {
        overridesByChain.set(chain, normalized)
      }
    }
  }
}

/** Snapshot of all current overrides, keyed by chain. */
export const getCustomRpcOverrides = (): Partial<Record<Chain, string>> => Object.fromEntries(overridesByChain)
