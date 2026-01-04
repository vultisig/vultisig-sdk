import type { Vultisig } from '@vultisig/sdk/electron'
import { BrowserWindow } from 'electron'

let sdkInstance: Vultisig | null = null
let sdkModule: typeof import('@vultisig/sdk/electron') | null = null

// Password cache TTL in milliseconds (5 minutes)
const PASSWORD_CACHE_TTL = 5 * 60 * 1000

// Pending password requests (for IPC-based password prompts)
const pendingPasswordRequests: Map<
  string,
  {
    resolve: (password: string) => void
    reject: (error: Error) => void
  }
> = new Map()

export async function initializeSDK(): Promise<Vultisig> {
  if (sdkInstance) {
    return sdkInstance
  }

  // Dynamic import to ensure WASM polyfills are applied first
  sdkModule = await import('@vultisig/sdk/electron')
  const { Vultisig } = sdkModule

  // SDK uses FileStorage by default in Electron (stores at ~/.vultisig)
  sdkInstance = new Vultisig({
    passwordCache: {
      defaultTTL: PASSWORD_CACHE_TTL,
    },
    onPasswordRequired: async (vaultId: string, vaultName?: string) => {
      // Send password request to renderer via IPC
      // Renderer will show modal and respond
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID()
        pendingPasswordRequests.set(requestId, { resolve, reject })

        // Send to renderer
        const mainWindow = BrowserWindow.getAllWindows()[0]
        if (mainWindow) {
          mainWindow.webContents.send('password-required', {
            requestId,
            vaultId,
            vaultName,
          })
        } else {
          pendingPasswordRequests.delete(requestId)
          reject(new Error('No window available for password prompt'))
        }

        // Timeout after 2 minutes
        setTimeout(() => {
          if (pendingPasswordRequests.has(requestId)) {
            pendingPasswordRequests.delete(requestId)
            reject(new Error('Password request timed out'))
          }
        }, 120000)
      })
    },
  })

  await sdkInstance.initialize()
  return sdkInstance
}

export function getSDK(): Vultisig {
  if (!sdkInstance) {
    throw new Error('SDK not initialized')
  }
  return sdkInstance
}

export function getSDKModule(): typeof import('@vultisig/sdk/electron') {
  if (!sdkModule) {
    throw new Error('SDK module not loaded')
  }
  return sdkModule
}

export function resolvePasswordRequest(requestId: string, password: string): void {
  const request = pendingPasswordRequests.get(requestId)
  if (request) {
    pendingPasswordRequests.delete(requestId)
    request.resolve(password)
  }
}

export function rejectPasswordRequest(requestId: string): void {
  const request = pendingPasswordRequests.get(requestId)
  if (request) {
    pendingPasswordRequests.delete(requestId)
    request.reject(new Error('Password request cancelled'))
  }
}

export function disposeSDK(): void {
  if (sdkInstance) {
    sdkInstance.dispose()
    sdkInstance = null
  }
}
