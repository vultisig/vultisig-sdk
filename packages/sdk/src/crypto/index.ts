/**
 * Cross-platform crypto singleton
 * Each platform bundle configures this with their crypto implementation
 */

import type { PlatformCrypto } from '../platforms/types'

// Module-level state
let platformCrypto: PlatformCrypto | null = null

/**
 * Configure the platform crypto implementation
 * Called automatically by platform bundles at module load time
 */
export function configureCrypto(crypto: PlatformCrypto): void {
  platformCrypto = crypto

  // Validate immediately for React Native (checks polyfills are installed)
  if (crypto.validateCrypto) {
    crypto.validateCrypto()
  }
}

/**
 * Get the configured crypto instance
 * @throws Error if crypto not configured
 */
function getCrypto(): PlatformCrypto {
  if (!platformCrypto) {
    throw new Error(
      'Crypto not configured. This should be configured automatically by platform bundles. ' +
        'If you see this error, ensure you are importing from the correct platform entry point.'
    )
  }
  return platformCrypto
}

/**
 * Generate a random UUID (v4)
 * Works in all platform environments
 *
 * @returns UUID string
 * @throws Error if crypto not configured
 */
export function randomUUID(): string {
  return getCrypto().randomUUID()
}
