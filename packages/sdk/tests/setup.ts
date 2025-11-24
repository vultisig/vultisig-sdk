/**
 * Test Setup File for Vultisig SDK
 * Provides global utilities, mocks, and helpers for all tests
 *
 * Phase 1: Foundation - Basic test infrastructure
 */

import { vi } from 'vitest'

// Type declaration for optional globals
declare const chrome: any

/**
 * Environment Detection
 * Used by tests to conditionally run environment-specific tests
 */
export const testEnvironment = {
  isNode: typeof process !== 'undefined' && process.versions?.node,
  isBrowser: typeof window !== 'undefined',
  isChromeExtension: typeof chrome !== 'undefined' && chrome.runtime,
  isElectron: typeof process !== 'undefined' && process.versions?.electron,
  hasFileSystem: typeof require !== 'undefined',
  hasCrypto: typeof crypto !== 'undefined',
  hasWebCrypto: typeof crypto !== 'undefined' && crypto.subtle,
}

/**
 * Test Utilities
 */
export const testUtils = {
  /**
   * Wait for a condition to become true
   * Useful for async operations in tests
   */
  waitFor: async (condition: () => boolean | Promise<boolean>, timeout = 5000, interval = 100): Promise<void> => {
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return
      }
      await new Promise(resolve => setTimeout(resolve, interval))
    }
    throw new Error(`Timeout waiting for condition after ${timeout}ms`)
  },

  /**
   * Sleep for a specified duration
   */
  sleep: (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Generate random hex string (useful for mock data)
   */
  randomHex: (length: number): string => {
    const bytes = new Uint8Array(length)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes)
    } else {
      // Fallback for environments without crypto
      for (let i = 0; i < length; i++) {
        bytes[i] = Math.floor(Math.random() * 256)
      }
    }
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  },

  /**
   * Create a mock timestamp
   */
  mockTimestamp: (daysAgo = 0): number => {
    return Date.now() - daysAgo * 24 * 60 * 60 * 1000
  },
}

/**
 * Mock Data Generators
 * Provides consistent mock data for tests
 */
export const mockData = {
  /**
   * Generate a mock vault name
   */
  vaultName: (index = 1): string => `Test Vault ${index}`,

  /**
   * Generate a mock email
   */
  email: (index = 1): string => `test${index}@vultisig.test`,

  /**
   * Generate a mock password
   */
  password: (strength: 'weak' | 'medium' | 'strong' = 'strong'): string => {
    switch (strength) {
      case 'weak':
        return 'password123'
      case 'medium':
        return 'Test1234!'
      case 'strong':
        return 'SecurePassword123!@#'
    }
  },

  /**
   * Mock blockchain addresses by chain
   */
  addresses: {
    bitcoin: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    ethereum: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
    solana: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK',
    thorchain: 'thor1xvj8z9fqm9v2xqy2z8z9fqm9v2xqy2z8z9fq',
    ripple: 'rN7n7otQDd6FczFgLdlqtyMVrn3VxZvnav',
  },

  /**
   * Mock key shares (not real - for testing only)
   */
  keyShare: (): string => testUtils.randomHex(64),

  /**
   * Mock public keys (not real - for testing only)
   */
  publicKey: (): string => testUtils.randomHex(66),
}

/**
 * Global Test Mocks
 * These are applied automatically to all tests
 */

// Mock console methods to reduce noise in test output (can be re-enabled per test)
export const mockConsole = {
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

// Store original console methods
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
}

/**
 * Enable/disable console mocking
 */
export const setConsoleLogging = (enabled: boolean): void => {
  if (enabled) {
    console.log = originalConsole.log
    console.info = originalConsole.info
    console.warn = originalConsole.warn
    console.error = originalConsole.error
    console.debug = originalConsole.debug
  } else {
    console.log = mockConsole.log
    console.info = mockConsole.info
    console.warn = mockConsole.warn
    console.error = mockConsole.error
    console.debug = mockConsole.debug
  }
}

/**
 * Network Request Mocking
 * Mock fetch for API calls
 */
export const mockFetch = vi.fn()

/**
 * Setup mock fetch responses
 */
export const setupMockFetch = (responses: Record<string, any>): typeof mockFetch => {
  mockFetch.mockImplementation((url: string | URL | Request) => {
    const urlString = url.toString()

    // Check if we have a mock response for this URL
    for (const [pattern, response] of Object.entries(responses)) {
      if (urlString.includes(pattern)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(response),
          text: () => Promise.resolve(JSON.stringify(response)),
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(response)).buffer),
        })
      }
    }

    // Default 404 response
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Not Found' }),
      text: () => Promise.resolve('Not Found'),
    })
  })

  return mockFetch
}

/**
 * WASM Test Helpers
 */
export const wasmHelpers = {
  /**
   * Check if WASM is supported in current environment
   */
  isWasmSupported: (): boolean => {
    return typeof WebAssembly !== 'undefined'
  },

  /**
   * Skip test if WASM is not supported
   */
  skipIfNoWasm: (): void => {
    if (!wasmHelpers.isWasmSupported()) {
      console.log('⚠️  Skipping test: WASM not supported in this environment')
      // Vitest doesn't have test.skip() available in setup
      // Tests should check this manually
    }
  },
}

/**
 * Cleanup utilities for tests
 */
export const cleanup = {
  /**
   * Clear all mocks
   */
  clearMocks: (): void => {
    vi.clearAllMocks()
    mockConsole.log.mockClear()
    mockConsole.info.mockClear()
    mockConsole.warn.mockClear()
    mockConsole.error.mockClear()
    mockConsole.debug.mockClear()
  },

  /**
   * Reset all mocks to initial state
   */
  resetMocks: (): void => {
    vi.resetAllMocks()
  },
}

/**
 * Assertion Helpers
 * Common assertions used across tests
 */
export const assertions = {
  /**
   * Assert that a value is a valid hex string
   */
  isValidHex: (value: string, expectedLength?: number): boolean => {
    const hexRegex = /^[0-9a-fA-F]+$/
    if (!hexRegex.test(value)) return false
    if (expectedLength && value.length !== expectedLength) return false
    return true
  },

  /**
   * Assert that a value is a valid blockchain address
   */
  isValidAddress: (address: string, chain?: string): boolean => {
    // Basic validation - real validation happens in the SDK
    if (!address || address.length < 20) return false

    switch (chain) {
      case 'bitcoin':
        return address.startsWith('bc1') || address.startsWith('1') || address.startsWith('3')
      case 'ethereum':
        return address.startsWith('0x') && address.length === 42
      case 'solana':
        return address.length >= 32 && address.length <= 44
      default:
        return address.length >= 20
    }
  },

  /**
   * Assert that a value is a valid timestamp
   */
  isValidTimestamp: (timestamp: number): boolean => {
    return (
      typeof timestamp === 'number' && timestamp > 0 && timestamp <= Date.now() + 1000 * 60 * 60 * 24 // Allow up to 1 day in future
    )
  },
}

/**
 * Performance Testing Utilities
 */
export const performance = {
  /**
   * Measure execution time of a function
   */
  measure: async <T>(fn: () => T | Promise<T>, label?: string): Promise<{ result: T; duration: number }> => {
    const start = Date.now()
    const result = await fn()
    const duration = Date.now() - start

    if (label) {
      console.log(`⏱️  ${label}: ${duration}ms`)
    }

    return { result, duration }
  },

  /**
   * Assert that a function completes within a time limit
   */
  expectWithinTime: async <T>(fn: () => T | Promise<T>, maxDuration: number, label?: string): Promise<T> => {
    const { result, duration } = await performance.measure(fn, label)

    if (duration > maxDuration) {
      throw new Error(`${label || 'Operation'} took ${duration}ms, expected < ${maxDuration}ms`)
    }

    return result
  },
}

// Export all utilities as a single namespace
export const testHelpers = {
  environment: testEnvironment,
  utils: testUtils,
  mockData,
  mockConsole,
  mockFetch,
  setupMockFetch,
  wasmHelpers,
  cleanup,
  assertions,
  performance,
  setConsoleLogging,
}

// Auto-configure console (disabled by default, can be enabled per test)
setConsoleLogging(false)

/**
 * Polyfills for Node.js test environment
 * Add File and Blob support for tests that need them
 */
if (testEnvironment.isNode && typeof File === 'undefined') {
  // @ts-ignore - Adding File polyfill
  global.File = class File {
    name: string
    type: string
    lastModified: number
    size: number
    _buffer: Buffer

    constructor(bits: BlobPart[], filename: string, options?: FilePropertyBag) {
      this.name = filename
      this.type = options?.type || ''
      this.lastModified = options?.lastModified || Date.now()

      // Combine all bits into a single buffer
      const buffers: Buffer[] = []
      for (const bit of bits) {
        if (bit instanceof Buffer) {
          buffers.push(bit)
        } else if (bit instanceof Uint8Array) {
          buffers.push(Buffer.from(bit))
        } else if (typeof bit === 'string') {
          buffers.push(Buffer.from(bit))
        } else if ((bit as any)?.constructor?.name === 'Blob') {
          // Handle Blob
          const blobBuffer = (bit as any)._buffer
          if (blobBuffer) {
            buffers.push(blobBuffer)
          }
        }
      }
      this._buffer = buffers.length > 0 ? Buffer.concat(buffers) : Buffer.alloc(0)
      this.size = this._buffer.length
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
      return this._buffer.buffer.slice(
        this._buffer.byteOffset,
        this._buffer.byteOffset + this._buffer.byteLength
      ) as ArrayBuffer
    }

    async text(): Promise<string> {
      return this._buffer.toString('utf-8')
    }
  }
}

if (testEnvironment.isNode && typeof Blob === 'undefined') {
  // @ts-ignore - Adding Blob polyfill
  global.Blob = class Blob {
    type: string
    size: number
    _buffer: Buffer

    constructor(bits: BlobPart[], options?: BlobPropertyBag) {
      this.type = options?.type || ''

      const buffers: Buffer[] = []
      for (const bit of bits) {
        if (bit instanceof Buffer) {
          buffers.push(bit)
        } else if (bit instanceof Uint8Array) {
          buffers.push(Buffer.from(bit))
        } else if (typeof bit === 'string') {
          buffers.push(Buffer.from(bit))
        }
      }
      this._buffer = buffers.length > 0 ? Buffer.concat(buffers) : Buffer.alloc(0)
      this.size = this._buffer.length
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
      return this._buffer.buffer.slice(
        this._buffer.byteOffset,
        this._buffer.byteOffset + this._buffer.byteLength
      ) as ArrayBuffer
    }

    async text(): Promise<string> {
      return this._buffer.toString('utf-8')
    }
  }
}

console.log('✅ Vultisig SDK test setup loaded')
console.log('🌍 Environment:', {
  node: testEnvironment.isNode,
  browser: testEnvironment.isBrowser,
  chromeExt: testEnvironment.isChromeExtension,
  electron: testEnvironment.isElectron,
  wasm: wasmHelpers.isWasmSupported(),
  file: typeof File !== 'undefined',
  blob: typeof Blob !== 'undefined',
})
