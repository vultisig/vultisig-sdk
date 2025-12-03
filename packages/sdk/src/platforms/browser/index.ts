/**
 * Browser platform entry point
 *
 * This bundle includes only browser-specific implementations:
 * - BrowserStorage (IndexedDB/localStorage)
 * - BrowserCrypto (Web Crypto API)
 * - BrowserPolyfills (Buffer, process)
 *
 * All Node.js/React Native code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { Vultisig, BrowserStorage } from '@vultisig/sdk/browser'
 *
 * const sdk = new Vultisig({
 *   storage: new BrowserStorage()
 * })
 * ```
 */

// Platform-specific implementations
// Configure global crypto to use Browser implementation
import { configureCrypto } from '../../crypto'
import { BrowserCrypto } from './crypto'
import { BrowserPolyfills } from './polyfills'
import { BrowserStorage } from './storage'
configureCrypto(new BrowserCrypto())

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { BrowserCrypto, BrowserPolyfills, BrowserStorage }
