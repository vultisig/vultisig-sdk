/**
 * Browser platform entry point
 *
 * This bundle includes only browser-specific implementations:
 * - BrowserStorage (IndexedDB/localStorage)
 * - BrowserCrypto (Web Crypto API)
 * - BrowserPolyfills (Buffer, process)
 *
 * All Node.js code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { Vultisig, Chain } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig()  // Uses BrowserStorage by default
 * await sdk.initialize()
 * ```
 */

import './initializePrep'

import { configureDefaultStorage } from '../../context/defaultStorage'
import { configureCrypto } from '../../crypto'
import { BrowserCrypto } from './crypto'
import { BrowserPolyfills } from './polyfills'
import { BrowserStorage } from './storage'

// Configure crypto
configureCrypto(new BrowserCrypto())

// Configure default storage for Browser
configureDefaultStorage(() => new BrowserStorage())

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { BrowserCrypto, BrowserPolyfills, BrowserStorage }

// Export BrowserStorage as the default Storage type for this platform
export { BrowserStorage as Storage }
