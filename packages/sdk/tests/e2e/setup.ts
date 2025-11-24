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
import { config } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Load environment variables from .env file
 * This allows test vault credentials to be stored securely outside of git
 */
const envPath = resolve(__dirname, '.env')
if (existsSync(envPath)) {
  config({ path: envPath })
  console.log('✅ Loaded .env file from:', envPath)
  console.log('   TEST_VAULT_PATH:', process.env.TEST_VAULT_PATH ? 'SET' : 'NOT SET')
  console.log('   TEST_VAULT_PASSWORD:', process.env.TEST_VAULT_PASSWORD ? 'SET' : 'NOT SET')
} else {
  console.log('ℹ️  No .env file found, using default test vault or exported env vars')
}

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
