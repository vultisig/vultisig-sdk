/**
 * Electron-specific utility functions.
 *
 * These helpers simplify Electron integration by providing:
 * - Automatic IPC handler setup for main process
 * - Process type detection
 * - File import/export for both main and renderer processes
 *
 * Usage in main.ts:
 * ```typescript
 * import { Vultisig } from '@vultisig/sdk'
 * import { setupElectronIPC } from '@vultisig/sdk'
 * import { ipcMain } from 'electron'
 *
 * const sdk = new Vultisig()
 * setupElectronIPC(sdk, ipcMain)
 * ```
 */

import type { Vultisig } from '../../Vultisig'
import type { Vault as VaultClass } from '../../vault/Vault'
import { detectEnvironment } from '../environment'

/**
 * IPC handler function signature
 */
type IPCHandler = (...args: unknown[]) => Promise<unknown>

/**
 * Setup all IPC handlers automatically for Electron main process.
 * This creates handlers for all vault operations that can be invoked from renderer process.
 *
 * @param sdk - Vultisig SDK instance
 * @param ipcMain - Electron's ipcMain module
 * @throws Error if not running in Electron main process
 *
 * @example
 * ```typescript
 * import { ipcMain } from 'electron'
 * import { Vultisig, setupElectronIPC } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig()
 * setupElectronIPC(sdk, ipcMain)
 * ```
 */
export function setupElectronIPC(
  sdk: Vultisig,
  ipcMain: {
    handle: (
      channel: string,
      listener: (...args: unknown[]) => Promise<unknown>
    ) => void
  }
): void {
  const processType = getElectronProcessType()
  if (processType !== 'main') {
    throw new Error(
      'setupElectronIPC can only be called in Electron main process'
    )
  }

  const handlers = getElectronHandlers(sdk)

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event: unknown, ...args: unknown[]) => {
      try {
        return await handler(...args)
      } catch (error) {
        // Re-throw to be caught by renderer
        throw error
      }
    })
  }
}

/**
 * Get IPC handlers for manual registration.
 * Use this if you need more control over handler registration.
 *
 * @param sdk - Vultisig SDK instance
 * @returns Record of channel names to handler functions
 * @throws Error if not running in Electron main process
 *
 * @example
 * ```typescript
 * const handlers = getElectronHandlers(sdk)
 * for (const [channel, handler] of Object.entries(handlers)) {
 *   ipcMain.handle(channel, handler)
 * }
 * ```
 */
export function getElectronHandlers(sdk: Vultisig): Record<string, IPCHandler> {
  const processType = getElectronProcessType()
  if (processType !== 'main') {
    throw new Error(
      'getElectronHandlers can only be called in Electron main process'
    )
  }

  return {
    'vault:connect': async (options?: unknown) => sdk.connect(options as any),

    'vault:disconnect': async () => sdk.disconnect(),

    'vault:isConnected': async () => sdk.isConnected(),

    'vault:getAccounts': async (chain?: string) => {
      const vault = sdk.getActiveVault()
      if (!vault) return []
      if (chain) {
        const address = await vault.address(chain)
        return address ? [address] : []
      }
      const chains = vault.getChains()
      const addresses = await vault.addresses(chains)
      return Object.values(addresses).filter(Boolean)
    },

    'vault:getActiveAccount': async (chain: string) => {
      const vault = sdk.getActiveVault()
      if (!vault) return null
      return await vault.address(chain)
    },

    'vault:getSupportedChains': async () => sdk.getSupportedChains(),

    'vault:getBalance': async (chain: string, tokenId?: string) => {
      const vault = sdk.getActiveVault()
      if (!vault) throw new Error('No active vault')
      return await vault.balance(chain, tokenId)
    },

    'vault:getBalances': async (chains?: string[]) => {
      const vault = sdk.getActiveVault()
      if (!vault) return {}
      const targetChains = chains ?? vault.getChains()
      return await vault.balances(targetChains)
    },

    'vault:signTransaction': async (params: any) => {
      const vault = sdk.getActiveVault()
      if (!vault) throw new Error('No active vault')
      const mode = params.mode ?? 'fast'
      return await vault.sign(mode, params.payload, params.password)
    },

    'vault:signMessage': async (params: any) => {
      const vault = sdk.getActiveVault()
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
    },

    'vault:signTypedData': async (params: any) => {
      const vault = sdk.getActiveVault()
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
    },

    'vault:createVault': async (name: string, options: unknown) =>
      sdk.createVault(name, options as any),

    'vault:importVault': async (file: unknown, password?: string) =>
      sdk.addVault(file as File, password),

    'vault:listVaults': async () => sdk.listVaults(),

    'vault:switchVault': async (vaultId: string) => sdk.switchVault(vaultId),

    'vault:deleteVault': async (vaultId: string) => {
      const vaults = await sdk.listVaults()
      const vault = vaults.find((v: any) => {
        const summary = v.summary ? v.summary() : v
        return summary.id === vaultId
      })
      if (vault) {
        return sdk.deleteVault(vault)
      }
    },

    'vault:getActiveVault': async () => {
      const vault = sdk.getActiveVault()
      return vault ? vault.summary() : null
    },
  }
}

/**
 * Detect Electron process type.
 * Returns 'main', 'renderer', or null if not running in Electron.
 *
 * @returns Process type or null
 *
 * @example
 * ```typescript
 * const processType = getElectronProcessType()
 * if (processType === 'main') {
 *   // Main process code
 * } else if (processType === 'renderer') {
 *   // Renderer process code
 * }
 * ```
 */
export function getElectronProcessType(): 'main' | 'renderer' | null {
  const env = detectEnvironment()
  if (env === 'electron-main') return 'main'
  if (env === 'electron-renderer') return 'renderer'
  return null
}

/**
 * Export vault to file in Electron main process.
 * This uses Node.js file system APIs which are only available in main process.
 *
 * @param vault - Vault instance to export
 * @param filePath - Absolute path where vault should be saved
 * @throws Error if not running in Electron main process
 *
 * @example
 * ```typescript
 * const vault = sdk.getActiveVault()
 * await exportElectronVaultToFile(vault, '/path/to/backup.vult')
 * ```
 */
export async function exportElectronVaultToFile(
  vault: VaultClass,
  filePath: string
): Promise<void> {
  const processType = getElectronProcessType()
  if (processType !== 'main') {
    throw new Error(
      'exportElectronVaultToFile can only be called in Electron main process'
    )
  }

  const fs = await import('fs/promises')
  const blob = await vault.export()
  const arrayBuffer = await blob.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  await fs.writeFile(filePath, buffer, { mode: 0o600 })
}

/**
 * Download vault in Electron renderer process.
 * This creates a download link and triggers browser-style download.
 *
 * @param vault - Vault instance to download
 * @param filename - Optional filename (defaults to vault name)
 * @throws Error if not running in Electron renderer process
 *
 * @example
 * ```typescript
 * const vault = sdk.getActiveVault()
 * await downloadElectronVault(vault, 'my-backup.vult')
 * ```
 */
export async function downloadElectronVault(
  vault: VaultClass,
  filename?: string
): Promise<void> {
  const processType = getElectronProcessType()
  if (processType !== 'renderer') {
    throw new Error(
      'downloadElectronVault can only be called in Electron renderer process'
    )
  }

  const blob = await vault.export()
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `${vault.data.name}.vult`
  document.body.appendChild(a)
  a.click()

  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
