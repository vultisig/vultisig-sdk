/**
 * Process-wide runtime configuration anchored on `globalThis` so duplicate
 * bundled copies of `@vultisig/mpc-types` still share one registry.
 */

type PlatformCryptoLike = { randomUUID: () => string; validateCrypto?: () => void }
type StorageLike = unknown

export type RuntimeStore = {
  mpcEngine: unknown | null
  walletCore: (() => Promise<unknown>) | null
  storageFactory: (() => StorageLike) | null
  crypto: PlatformCryptoLike | null
}

const STORE_KEY = Symbol.for('vultisig.runtime.store.v1')

export function runtimeStore(): RuntimeStore {
  const g = globalThis as Record<PropertyKey, unknown>
  let s = g[STORE_KEY] as RuntimeStore | undefined
  if (!s) {
    s = { mpcEngine: null, walletCore: null, storageFactory: null, crypto: null }
    g[STORE_KEY] = s
  }
  return s
}

/** Test-only: clears the process-wide store. */
export function __resetRuntimeStoreForTesting(): void {
  delete (globalThis as Record<PropertyKey, unknown>)[STORE_KEY]
}
