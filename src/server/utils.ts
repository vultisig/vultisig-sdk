/**
 * Shared server utilities for VultiServer and message relay operations
 */

/**
 * Generate a unique session ID using native UUID v4
 */
export const generateSessionId = (): string => {
  return crypto.randomUUID()
}

/**
 * Generate encryption key (32-byte hex) using existing crypto utilities
 */
export const generateEncryptionKey = async (): Promise<string> => {
  const { getHexEncodedRandomBytes } = await import('../crypto')
  return getHexEncodedRandomBytes(32)
}

/**
 * Generate chain code (32-byte hex) using existing crypto utilities
 */
export const generateChainCode = async (): Promise<string> => {
  const { getHexEncodedRandomBytes } = await import('../crypto')
  return getHexEncodedRandomBytes(32)
}

/**
 * Generate browser/extension party ID for server operations
 */
export const generateBrowserPartyId = async (): Promise<string> => {
  const { generateLocalPartyId } = await import('../core/mpc/devices/localPartyId')
  return generateLocalPartyId('extension')
}

/**
 * Generate server party ID for VultiServer operations
 */
export const generateServerPartyId = async (): Promise<string> => {
  const { generateLocalPartyId } = await import('../core/mpc/devices/localPartyId')
  return generateLocalPartyId('server')
}

/**
 * Ping a server endpoint for health check
 */
export const pingServer = async (baseUrl: string, endpoint: string = '', timeout: number = 5000): Promise<number> => {
  const start = Date.now()
  
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, { 
      method: 'GET',
      signal: AbortSignal.timeout(timeout)
    })
    
    // If we get any HTTP response (even 404), server is reachable
    return Date.now() - start
  } catch (error: any) {
    // Check if it's a timeout or network error vs HTTP error
    if (error.name === 'AbortError' || error.name === 'TypeError') {
      throw error
    }
    
    // If we get here, server responded with an error but is reachable
    return Date.now() - start
  }
}
