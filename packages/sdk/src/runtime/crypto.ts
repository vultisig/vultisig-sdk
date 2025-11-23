/**
 * Cross-platform crypto utilities
 * Provides Web Crypto API access in both browser and Node.js environments
 */

// Cache the crypto instance to avoid repeated checks
let cachedCrypto: Crypto | undefined
let initializationPromise: Promise<void> | undefined

/**
 * Get or initialize the crypto object (Web Crypto API)
 * Works in both browser and Node.js environments
 *
 * The bundler creates environment-specific builds:
 * - Node.js builds (ESM/CJS): crypto module is external and imported dynamically
 * - Browser builds (UMD): uses globalThis.crypto (Web Crypto API)
 *
 * @returns Promise resolving to Crypto instance
 * @throws Error if crypto is not available
 */
async function getCryptoAsync(): Promise<Crypto> {
  // Return cached instance if available
  if (cachedCrypto) {
    return cachedCrypto
  }

  // Try globalThis.crypto first (browsers and Node.js 18+ with --experimental-global-webcrypto)
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    cachedCrypto = globalThis.crypto
    return cachedCrypto
  }

  // Node.js environment - dynamically import crypto module (marked as external in build)
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const cryptoModule = await import('crypto')
      const nodeCrypto = cryptoModule.default || cryptoModule

      // Node.js 15+: Use webcrypto property for Web Crypto API compatibility
      if (
        nodeCrypto.webcrypto &&
        typeof nodeCrypto.webcrypto.randomUUID === 'function'
      ) {
        cachedCrypto = nodeCrypto.webcrypto as Crypto
        return cachedCrypto
      }

      // Fallback: Node.js crypto has randomUUID directly
      if (typeof nodeCrypto.randomUUID === 'function') {
        cachedCrypto = nodeCrypto as unknown as Crypto
        return cachedCrypto
      }
    } catch {
      // Dynamic import failed, fall through to error
    }
  }

  throw new Error(
    'Crypto API not available. Ensure you are using Node.js 15+ or a modern browser.'
  )
}

/**
 * Synchronous getter for crypto (after initialization)
 * @deprecated Use getCryptoAsync or ensure initializeCrypto has been called
 */
export function getCrypto(): Crypto {
  if (!cachedCrypto) {
    throw new Error('Crypto not initialized. Call initializeCrypto() first.')
  }
  return cachedCrypto
}

/**
 * Initialize crypto and validate it's available
 * Should be called during SDK initialization
 *
 * @returns Promise that resolves when crypto is initialized
 * @throws Error if crypto cannot be initialized
 */
export async function initializeCrypto(): Promise<void> {
  // Return existing promise if already initializing/initialized
  if (initializationPromise) {
    return initializationPromise
  }

  initializationPromise = (async () => {
    try {
      // Force crypto detection using async version
      const crypto = await getCryptoAsync()

      // Validate that randomUUID is available
      if (typeof crypto.randomUUID !== 'function') {
        throw new Error(
          'Crypto API is available but randomUUID function is missing'
        )
      }

      // Test that it actually works
      const testUuid = crypto.randomUUID()
      if (!testUuid || typeof testUuid !== 'string') {
        throw new Error('Crypto randomUUID function does not work correctly')
      }
    } catch (error) {
      // Clear the promise so it can be retried
      initializationPromise = undefined
      throw error
    }
  })()

  return initializationPromise
}

/**
 * Generate a random UUID (v4)
 * Works in both browser and Node.js environments
 *
 * @returns UUID string
 */
export function randomUUID(): string {
  return getCrypto().randomUUID()
}
