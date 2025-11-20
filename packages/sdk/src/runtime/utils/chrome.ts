/**
 * Chrome Extension-specific utility functions.
 *
 * These helpers simplify Chrome extension integration:
 * - Message passing between popup and background service worker
 * - Storage monitoring across extension contexts
 * - Service worker lifecycle management
 *
 * Architecture Pattern:
 * - Background Service Worker: Runs SDK, handles vault operations
 * - Popup/Options Pages: Send messages to background, receive responses
 *
 * Usage in background.ts (service worker):
 * ```typescript
 * import { Vultisig, setupChromeMessageHandlers } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig({ autoInit: true })
 * setupChromeMessageHandlers(sdk)
 * ```
 *
 * Usage in popup.ts:
 * ```typescript
 * import { sendChromeMessage } from '@vultisig/sdk'
 *
 * const signature = await sendChromeMessage('signTransaction', {
 *   chain: 'Ethereum',
 *   payload: tx
 * })
 * ```
 */

import type { Vultisig } from '../../Vultisig'
import { isChromeExtension } from '../environment'

/**
 * Setup message handlers in Chrome extension background service worker.
 * This allows popup/options pages to communicate with the SDK running in the background.
 *
 * @param sdk - Vultisig SDK instance
 * @throws Error if not running in Chrome extension
 *
 * @example
 * ```typescript
 * // background.ts (service worker)
 * import { Vultisig, setupChromeMessageHandlers } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig({ autoInit: true })
 * setupChromeMessageHandlers(sdk)
 * ```
 */
export function setupChromeMessageHandlers(sdk: Vultisig): void {
  if (!isChromeExtension()) {
    throw new Error(
      'setupChromeMessageHandlers can only be called in Chrome extension'
    )
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle async operations
    handleChromeMessage(sdk, request)
      .then(sendResponse)
      .catch(error => {
        sendResponse({ error: error.message })
      })

    // Return true to indicate async response
    return true
  })
}

/**
 * Internal message handler
 * @private
 */
async function handleChromeMessage(sdk: Vultisig, request: any): Promise<any> {
  const { action, params } = request

  switch (action) {
    case 'connect':
      return await sdk.connect(params)

    case 'disconnect':
      return await sdk.disconnect()

    case 'isConnected':
      return sdk.isConnected()

    case 'createVault':
      return await sdk.createVault(params.name, params.options)

    case 'getAccounts': {
      const vault = await sdk.getActiveVault()
      if (!vault) return []
      if (params?.chain) {
        const address = await vault.address(params.chain)
        return address ? [address] : []
      }
      const chains = vault.getChains()
      const addresses = await vault.addresses(chains)
      return Object.values(addresses).filter(Boolean)
    }

    case 'getActiveAccount': {
      const vault = await sdk.getActiveVault()
      if (!vault) return null
      return await vault.address(params.chain)
    }

    case 'getBalance': {
      const vault = await sdk.getActiveVault()
      if (!vault) throw new Error('No active vault')
      return await vault.balance(params.chain, params.tokenId)
    }

    case 'getBalances': {
      const vault = await sdk.getActiveVault()
      if (!vault) return {}
      const targetChains = params?.chains ?? vault.getChains()
      return await vault.balances(targetChains)
    }

    case 'signTransaction': {
      const vault = await sdk.getActiveVault()
      if (!vault) throw new Error('No active vault')
      const mode = params.mode ?? 'fast'
      return await vault.sign(mode, params.payload, params.password)
    }

    case 'signMessage': {
      const vault = await sdk.getActiveVault()
      if (!vault) throw new Error('No active vault')
      const signature = await vault.sign(
        'local',
        {
          transaction: { type: 'message', message: params.message },
          chain: params.chain,
        },
        params.password
      )
      return signature.signature
    }

    case 'signTypedData': {
      const vault = await sdk.getActiveVault()
      if (!vault) throw new Error('No active vault')
      const signature = await vault.sign(
        'local',
        {
          transaction: { type: 'typedData', data: params.typedData },
          chain: params.chain,
        },
        params.password
      )
      return signature.signature
    }

    case 'listVaults':
      return await sdk.listVaults()

    case 'switchVault':
      return await sdk.switchVault(params.vaultId)

    case 'deleteVault': {
      const vaults = await sdk.listVaults()
      const vault = vaults.find((v: any) => {
        const summary = v.summary ? v.summary() : v
        return summary.id === params.vaultId
      })
      if (vault) {
        return await sdk.deleteVault(vault)
      }
      throw new Error(`Vault not found: ${params.vaultId}`)
    }

    case 'getActiveVault': {
      const activeVault = await sdk.getActiveVault()
      return activeVault ? activeVault.summary() : null
    }

    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

/**
 * Send message to Chrome extension background service worker.
 * Use this from popup/options pages to interact with SDK in background.
 *
 * @param action - Action name
 * @param params - Action parameters
 * @returns Promise with response data
 * @throws Error if not running in Chrome extension or if action fails
 *
 * @example
 * ```typescript
 * // popup.ts
 * import { sendChromeMessage } from '@vultisig/sdk'
 *
 * // Sign transaction
 * const signature = await sendChromeMessage('signTransaction', {
 *   chain: 'Ethereum',
 *   payload: tx,
 *   mode: 'fast'
 * })
 *
 * // Get accounts
 * const accounts = await sendChromeMessage('getAccounts', {
 *   chain: 'Ethereum'
 * })
 * ```
 */
export async function sendChromeMessage<T = any>(
  action: string,
  params?: any
): Promise<T> {
  if (!isChromeExtension()) {
    throw new Error('sendChromeMessage can only be called in Chrome extension')
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, params }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else if (response?.error) {
        reject(new Error(response.error))
      } else {
        resolve(response)
      }
    })
  })
}

/**
 * Keep service worker alive by sending periodic heartbeat messages.
 * Chrome kills service workers after 30 seconds of inactivity.
 * Call this from popup/options to keep background SDK alive.
 *
 * @param intervalMs - Heartbeat interval in milliseconds (default: 20000 = 20s)
 * @returns Cleanup function to stop heartbeat
 *
 * @example
 * ```typescript
 * // popup.ts
 * import { keepServiceWorkerAlive } from '@vultisig/sdk'
 *
 * // Keep background alive while popup is open
 * const stopHeartbeat = keepServiceWorkerAlive()
 *
 * // Stop when popup closes
 * window.addEventListener('unload', stopHeartbeat)
 * ```
 */
export function keepServiceWorkerAlive(intervalMs: number = 20000): () => void {
  if (!isChromeExtension()) {
    throw new Error(
      'keepServiceWorkerAlive can only be called in Chrome extension'
    )
  }

  const interval = setInterval(() => {
    // Send heartbeat to background
    chrome.runtime.sendMessage({ action: 'heartbeat' }, () => {
      // Ignore errors (service worker might be restarting)
      if (chrome.runtime.lastError) {
        // Silently ignore
      }
    })
  }, intervalMs)

  return () => clearInterval(interval)
}

/**
 * Check if Chrome extension service worker is alive.
 *
 * @returns Promise resolving to true if alive, false otherwise
 *
 * @example
 * ```typescript
 * const isAlive = await isServiceWorkerAlive()
 * if (!isAlive) {
 *   console.log('Background service worker is down, it will restart on next message')
 * }
 * ```
 */
export async function isServiceWorkerAlive(): Promise<boolean> {
  if (!isChromeExtension()) {
    return false
  }

  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'ping' }, _response => {
      resolve(!chrome.runtime.lastError)
    })
  })
}

/**
 * Listen for storage changes across Chrome extension contexts.
 * Useful for reactive UI updates when vault state changes.
 *
 * @param callback - Called when storage changes
 * @returns Cleanup function to stop listening
 *
 * @example
 * ```typescript
 * // popup.ts
 * import { onChromeStorageChanged } from '@vultisig/sdk'
 *
 * const unsubscribe = onChromeStorageChanged((changes) => {
 *   if (changes['vault:activeVaultId']) {
 *     console.log('Active vault changed!')
 *     refreshUI()
 *   }
 * })
 * ```
 */
export function onChromeStorageChanged(
  callback: (changes: { [key: string]: chrome.storage.StorageChange }) => void
): () => void {
  if (!isChromeExtension()) {
    throw new Error(
      'onChromeStorageChanged can only be called in Chrome extension'
    )
  }

  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
  ) => {
    if (areaName === 'local') {
      callback(changes)
    }
  }

  chrome.storage.onChanged.addListener(listener)

  return () => {
    chrome.storage.onChanged.removeListener(listener)
  }
}
