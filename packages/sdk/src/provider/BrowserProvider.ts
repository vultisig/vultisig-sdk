import { BaseProvider } from './BaseProvider'
import { BrowserStorage } from './storage/BrowserStorage'
import type { ProviderConfig } from './types'
import type { Vault as VaultClass } from '../vault/Vault'

/**
 * Provider optimized for browser environments.
 *
 * Features:
 * - IndexedDB storage (primary, ~50MB+)
 * - localStorage fallback (~5-10MB)
 * - In-memory fallback (for private browsing)
 * - Automatic fallback chain on quota exceeded
 * - Browser-specific export methods
 *
 * Security Notes:
 * - Subject to XSS attacks - ensure proper CSP headers
 * - Data stored in plain text - use vault encryption for sensitive data
 * - Private browsing mode uses in-memory storage (lost on close)
 */
export class BrowserProvider extends BaseProvider {
  constructor(config: ProviderConfig = {}) {
    // Auto-select browser storage if not provided
    const storage = config.storage ?? new BrowserStorage()
    super({ ...config, storage })
  }

  /**
   * Export vault as Blob (browser-specific).
   * Can be used with download links or File API.
   *
   * @param vaultId - ID of vault to export
   * @returns Blob containing vault data
   */
  async exportVault(vaultId?: string): Promise<Blob> {
    const vault = vaultId
      ? await this.getVaultById(vaultId)
      : this.getActiveVault()

    if (!vault) {
      throw new Error('No vault to export')
    }

    // Use vault's built-in export method
    return await vault.export()
  }

  /**
   * Download vault file (browser-specific).
   * Creates temporary download link and triggers download.
   *
   * @param vaultId - Optional vault ID (defaults to active vault)
   * @param filename - Optional filename (defaults to vault name)
   */
  async downloadVault(vaultId?: string, filename?: string): Promise<void> {
    const vault = vaultId
      ? await this.getVaultById(vaultId)
      : this.getActiveVault()

    if (!vault) {
      throw new Error('No vault to download')
    }

    const blob = await this.exportVault(vaultId)
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = filename ?? `${vault.data.name}.vult`
    document.body.appendChild(a)
    a.click()

    // Cleanup
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
   * Clear browser storage (including IndexedDB and localStorage)
   */
  async clearStorage(): Promise<void> {
    await this.storage.clear()
  }

  /**
   * Get storage usage and quota information
   */
  async getStorageInfo(): Promise<{
    usage: number
    quota?: number
    percentage?: number
  }> {
    const usage = await this.storage.getUsage?.() ?? 0
    const quota = await this.storage.getQuota?.() ?? undefined

    return {
      usage,
      quota,
      percentage: quota ? (usage / quota) * 100 : undefined,
    }
  }
}
