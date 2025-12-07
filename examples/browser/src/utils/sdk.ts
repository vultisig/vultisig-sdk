import { Vultisig } from '@vultisig/sdk'

let sdkInstance: Vultisig | null = null

/**
 * Password cache TTL in milliseconds (5 minutes)
 */
const PASSWORD_CACHE_TTL = 5 * 60 * 1000

/**
 * Initialize the Vultisig SDK with browser-specific configuration
 */
export async function initializeSDK(): Promise<Vultisig> {
  if (sdkInstance) {
    return sdkInstance
  }

  // Initialize SDK with instance-scoped configuration
  // Storage defaults to BrowserStorage in browser environment
  sdkInstance = new Vultisig({
    passwordCache: {
      defaultTTL: PASSWORD_CACHE_TTL,
    },
    onPasswordRequired: async (vaultId: string, vaultName?: string) => {
      // This will be called when a vault needs to be unlocked
      // In a real app, show a modal dialog to collect the password
      const displayName = vaultName || vaultId.slice(0, 8)
      const password = window.prompt(`Please enter the password for vault: ${displayName}`)

      if (!password) {
        throw new Error('Password required')
      }

      return password
    },
  })
  await sdkInstance.initialize()

  return sdkInstance
}

/**
 * Get the initialized SDK instance
 * @throws Error if SDK is not initialized
 */
export function getSDK(): Vultisig {
  if (!sdkInstance) {
    throw new Error('SDK not initialized. Call initializeSDK() first.')
  }
  return sdkInstance
}
