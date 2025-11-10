/**
 * E2E Test Setup File
 *
 * This setup file is specifically for E2E tests and MUST NOT mock any APIs
 * since E2E tests need to make real network calls to production blockchain RPCs.
 *
 * WASM loading is handled by:
 * 1. vitest.setup.ts (root) - Global fetch polyfill for WASM files
 * 2. tests/integration/setup.ts - Enhanced WASM loading for file:// URLs
 * 3. tests/setup.ts - General test utilities
 */

import { webcrypto } from 'crypto'

/**
 * Polyfill for Web Crypto API in Node.js
 * The SDK uses crypto.randomUUID() which is available in Node.js via webcrypto
 */
if (typeof globalThis.crypto === 'undefined') {
  // @ts-ignore - polyfill crypto
  globalThis.crypto = webcrypto
}

console.log('✅ E2E test setup loaded')
console.log('🌐 Real network calls ENABLED (no API mocks)')
console.log('📡 Tests will query production blockchain RPCs')
