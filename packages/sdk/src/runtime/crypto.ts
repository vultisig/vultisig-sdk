/**
 * Cross-platform crypto utilities
 * Provides Web Crypto API access in both browser and Node.js environments
 */

// Cache the crypto instance to avoid repeated checks
let cachedCrypto: Crypto | undefined

/**
 * Get the crypto object (Web Crypto API)
 * Works in both browser and Node.js environments
 *
 * @returns Crypto instance
 * @throws Error if crypto is not available
 */
export function getCrypto(): Crypto {
  // Return cached instance if available
  if (cachedCrypto) {
    return cachedCrypto
  }

  // Browser/Web environment
  if (typeof globalThis.crypto !== 'undefined') {
    cachedCrypto = globalThis.crypto
    return cachedCrypto
  }

  // Node.js environment - use webcrypto
  // Access via globalThis to avoid direct require()
  try {
    // In Node.js, crypto.webcrypto is available on globalThis.crypto
    // or we need to access the crypto module
    const nodeCrypto = (globalThis as any).process?.versions?.node
      ? // Use Function constructor to avoid static analysis detecting require
        new Function("return require('crypto')")()
      : null

    if (nodeCrypto?.webcrypto) {
      cachedCrypto = nodeCrypto.webcrypto as Crypto
      return cachedCrypto
    }
  } catch {
    // Fall through to error
  }

  throw new Error(
    'Crypto API not available. This should not happen in modern Node.js or browsers.'
  )
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
