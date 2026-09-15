/**
 * Chrome Extension platform entry point
 *
 * This bundle includes Chrome Extension-specific implementations:
 * - ChromeExtensionStorage (chrome.storage.local API)
 * - ChromeExtensionCrypto (Web Crypto API)
 * - ChromeExtensionPolyfills (Buffer, process via globalThis)
 *
 * Works in all extension contexts: service worker (background),
 * popup, options page, and content scripts.
 *
 * Requirements:
 * - Manifest V3 with "storage" permission
 * - CSP with 'wasm-unsafe-eval' for WASM modules
 *
 * Usage:
 * ```typescript
 * import { Vultisig, Chain } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig()  // Uses ChromeExtensionStorage by default
 * await sdk.initialize()
 * ```
 */

import '../browser/initializePrep'

import { configureDefaultStorage } from '../../context/defaultStorage'
import { configureCrypto } from '../../crypto'
import { ChromeExtensionCrypto } from './crypto'
import { ChromeExtensionPolyfills } from './polyfills'
import { ChromeExtensionStorage } from './storage'

// Configure crypto
configureCrypto(new ChromeExtensionCrypto())

// Configure default storage for Chrome Extension
configureDefaultStorage(() => new ChromeExtensionStorage())

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users who want to customize
export { ChromeExtensionCrypto, ChromeExtensionPolyfills, ChromeExtensionStorage }

// Export ChromeExtensionStorage as the default Storage type for this platform
export { ChromeExtensionStorage as Storage }
