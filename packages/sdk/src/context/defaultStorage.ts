/**
 * Default storage configuration
 *
 * Platform entry points (browser/index.ts, node/index.ts) register their
 * default storage factory on module load. The Vultisig class uses this
 * to auto-create storage when none is provided.
 */

import type { Storage } from '../storage/types'

let defaultStorageFactory: (() => Storage) | null = null

/**
 * Configure the default storage factory (called by platform entry points on module load)
 */
export function configureDefaultStorage(factory: () => Storage): void {
  defaultStorageFactory = factory
}

/**
 * Get a new instance of the default storage for the current platform
 * @throws Error if storage not configured (wrong import path used)
 */
export function getDefaultStorage(): Storage {
  if (!defaultStorageFactory) {
    throw new Error(
      'Default storage not configured. Import from @vultisig/sdk (not /node or /browser subpaths directly).'
    )
  }
  return defaultStorageFactory()
}
