import { BaseProvider } from './BaseProvider'
import { BrowserStorage } from './storage/BrowserStorage'
import { NodeStorage } from './storage/NodeStorage'
import { detectEnvironment } from './environment'
import type { ProviderConfig } from './types'
import type { VaultStorage } from './storage/types'
import type { Vault as VaultClass } from '../vault/Vault'

/**
 * Provider optimized for Electron applications.
 *
 * Features:
 * - Automatically uses appropriate storage based on process type
 * - Main process: Filesystem (userData directory)
 * - Renderer process: IndexedDB
 * - IPC helpers for secure communication
 * - Electron-specific export methods
 *
 * Process Detection:
 * - Main process: Has Node.js APIs, uses filesystem
 * - Renderer process: Has browser APIs, uses IndexedDB
 *
 * Security Notes:
 * - Main process has full filesystem access
 * - Renderer process should communicate via IPC for sensitive operations
 * - Use preload scripts for secure IPC
 */
export class ElectronProvider extends BaseProvider {
  private readonly processType: 'main' | 'renderer'

  constructor(config: ProviderConfig = {}) {
    const env = detectEnvironment()
    const processType = env === 'electron-main' ? 'main' : 'renderer'

    // Auto-select storage based on process type
    const storage = config.storage ?? ElectronProvider.createStorage(processType)

    super({ ...config, storage })
    this.processType = processType
  }

  /**
   * Create appropriate storage for process type
   */
  private static createStorage(processType: 'main' | 'renderer'): VaultStorage {
    if (processType === 'main') {
      // Main process: Use filesystem with userData directory
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { app } = require('electron')
        const path = require('path')
        const basePath = path.join(app.getPath('userData'), '.vultisig')
        return new NodeStorage({ basePath })
      } catch (error) {
        console.warn('Failed to access Electron app.getPath, using default:', error)
        return new NodeStorage()
      }
    } else {
      // Renderer process: Use IndexedDB
      return new BrowserStorage()
    }
  }

  /**
   * Get IPC handlers for use in main process.
   *
   * Example usage in main.ts:
   * ```typescript
   * const provider = new ElectronProvider()
   * const handlers = provider.getIPCHandlers()
   *
   * // Register handlers
   * for (const [channel, handler] of Object.entries(handlers)) {
   *   ipcMain.handle(channel, handler)
   * }
   * ```
   */
  getIPCHandlers(): Record<string, (...args: unknown[]) => Promise<unknown>> {
    if (this.processType !== 'main') {
      throw new Error('IPC handlers only available in main process')
    }

    return {
      'vault:connect': async (options?: unknown) =>
        this.connect(options as any),

      'vault:disconnect': async () =>
        this.disconnect(),

      'vault:isConnected': async () =>
        this.isConnected(),

      'vault:getAccounts': async (chain?: string) =>
        this.getAccounts(chain),

      'vault:getActiveAccount': async (chain: string) =>
        this.getActiveAccount(chain),

      'vault:getSupportedChains': async () =>
        this.getSupportedChains(),

      'vault:getBalance': async (params: unknown) =>
        this.getBalance(params as any),

      'vault:getBalances': async (chains?: string[]) =>
        this.getBalances(chains),

      'vault:signTransaction': async (params: unknown) =>
        this.signTransaction(params as any),

      'vault:sendTransaction': async (params: unknown) =>
        this.sendTransaction(params as any),

      'vault:signMessage': async (params: unknown) =>
        this.signMessage(params as any),

      'vault:signTypedData': async (params: unknown) =>
        this.signTypedData(params as any),

      'vault:createVault': async (options: unknown) =>
        this.createVault(options as any),

      'vault:importVault': async (file: unknown, password?: string) =>
        this.importVault(file as Buffer, password),

      'vault:listVaults': async () =>
        this.listVaults(),

      'vault:switchVault': async (vaultId: string) =>
        this.switchVault(vaultId),

      'vault:deleteVault': async (vaultId: string) =>
        this.deleteVault(vaultId),

      'vault:getActiveVault': async () => {
        const vault = this.getActiveVault()
        return vault ? vault.summary() : null
      },
    }
  }

  /**
   * Setup all IPC handlers automatically.
   *
   * Usage in main.ts:
   * ```typescript
   * import { ipcMain } from 'electron'
   * const provider = new ElectronProvider()
   * provider.setupIPCHandlers(ipcMain)
   * ```
   */
  setupIPCHandlers(ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => Promise<unknown>) => void
  }): void {
    if (this.processType !== 'main') {
      throw new Error('IPC handlers only available in main process')
    }

    const handlers = this.getIPCHandlers()

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
   * Get storage path (main process only).
   */
  getStoragePath(): string {
    if (this.processType !== 'main') {
      throw new Error('Storage path only available in main process')
    }
    return (this.storage as NodeStorage).basePath
  }

  /**
   * Export vault to file (main process only).
   */
  async exportVaultToFile(
    filePath: string,
    vaultId?: string
  ): Promise<void> {
    if (this.processType !== 'main') {
      throw new Error('File export only available in main process')
    }

    const vault = vaultId
      ? await this.getVaultById(vaultId)
      : this.getActiveVault()

    if (!vault) {
      throw new Error('No vault to export')
    }

    const fs = await import('fs/promises')
    const blob = await vault.export()
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    await fs.writeFile(filePath, buffer, { mode: 0o600 })
  }

  /**
   * Download vault (renderer process only).
   */
  async downloadVault(vaultId?: string, filename?: string): Promise<void> {
    if (this.processType !== 'renderer') {
      throw new Error('Download only available in renderer process')
    }

    const vault = vaultId
      ? await this.getVaultById(vaultId)
      : this.getActiveVault()

    if (!vault) {
      throw new Error('No vault to download')
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

  /**
   * Get vault by ID (helper method)
   */
  private async getVaultById(vaultId: string): Promise<VaultClass> {
    await this.switchVault(vaultId)
    const vault = this.getActiveVault()
    if (!vault) {
      throw new Error(`Vault not found: ${vaultId}`)
    }
    return vault
  }

  /**
   * Get process type
   */
  getProcessType(): 'main' | 'renderer' {
    return this.processType
  }
}
