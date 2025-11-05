import { BaseProvider } from './BaseProvider'
import { NodeStorage } from './storage/NodeStorage'
import type { ProviderConfig } from './types'
import type { Vault as VaultClass } from '../vault/Vault'

/**
 * Provider optimized for Node.js environments.
 *
 * Features:
 * - Filesystem-based persistent storage
 * - Atomic writes (temp file + rename)
 * - Default path: ~/.vultisig
 * - Custom storage path support
 * - Node-specific export methods
 *
 * Security Notes:
 * - Files stored with 0600 permissions (owner read/write only)
 * - Ensure proper OS-level security and disk encryption
 * - Storage path should be in secure location
 */
export class NodeProvider extends BaseProvider {
  constructor(config: ProviderConfig = {}) {
    // Auto-select Node storage if not provided
    const storage = config.storage ?? new NodeStorage()
    super({ ...config, storage })
  }

  /**
   * Export vault to file (Node-specific).
   *
   * @param filePath - Absolute path where vault should be exported
   * @param vaultId - Optional vault ID (defaults to active vault)
   */
  async exportVaultToFile(
    filePath: string,
    vaultId?: string
  ): Promise<void> {
    const vault = vaultId
      ? await this.getVaultById(vaultId)
      : this.getActiveVault()

    if (!vault) {
      throw new Error('No vault to export')
    }

    const fs = await import('fs/promises')

    // Export vault as blob
    const blob = await vault.export()

    // Convert blob to buffer
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Write to file
    await fs.writeFile(filePath, buffer, { mode: 0o600 })
  }

  /**
   * Import vault from file (Node-specific).
   *
   * @param filePath - Absolute path to vault file
   * @param password - Optional password for encrypted vaults
   */
  async importVaultFromFile(
    filePath: string,
    password?: string
  ): Promise<VaultClass> {
    const fs = await import('fs/promises')
    const buffer = await fs.readFile(filePath)

    // Import using base provider method
    return await this.importVault(buffer, password)
  }

  /**
   * Get storage directory path.
   */
  getStoragePath(): string {
    return (this.storage as NodeStorage).basePath
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
   * Get storage usage information
   */
  async getStorageInfo(): Promise<{
    usage: number
    path: string
  }> {
    const usage = await this.storage.getUsage?.() ?? 0

    return {
      usage,
      path: this.getStoragePath(),
    }
  }
}
