/**
 * StorageManager - Persistent storage for vaults, settings, and active vault state
 *
 * Uses localStorage in browser environments and in-memory storage as fallback for Node.js.
 * Compatible with existing React app storage using the same storage keys.
 */

const STORAGE_KEYS = {
  vaults: 'vultisig_keyshares', // Reuse existing key for React app compatibility
  currentVaultId: 'vultisig_current_vault_id',
  settings: 'vultisig_settings',
} as const

export type StoredVault = {
  id: string
  name: string
  size?: number
  encrypted: boolean | null
  dateAdded: number
  containerBase64?: string
}

export type Settings = {
  defaultCurrency: string
  defaultChains: string[]
  isBalanceVisible: boolean
}

const DEFAULT_SETTINGS: Settings = {
  defaultCurrency: 'USD',
  defaultChains: ['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple'],
  isBalanceVisible: true,
}

/**
 * In-memory storage implementation for Node.js environments
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>()

  get length(): number {
    return this.data.size
  }

  getItem(key: string): string | null {
    return this.data.get(key) || null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  clear(): void {
    this.data.clear()
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] || null
  }
}

/**
 * StorageManager handles all persistent storage operations for the SDK
 */
export class StorageManager {
  private storage: Storage

  constructor() {
    this.storage =
      typeof localStorage !== 'undefined' ? localStorage : new MemoryStorage()
  }

  // ===== VAULT OPERATIONS =====

  async saveVault(vault: StoredVault): Promise<void> {
    try {
      const vaults = await this.getVaults()
      const existingIndex = vaults.findIndex(v => v.id === vault.id)

      if (existingIndex >= 0) {
        vaults[existingIndex] = {
          ...vaults[existingIndex],
          ...vault,
          dateAdded: vaults[existingIndex].dateAdded,
        }
      } else {
        vaults.unshift({
          ...vault,
          dateAdded: vault.dateAdded || Date.now(),
        })
      }

      this.storage.setItem(STORAGE_KEYS.vaults, JSON.stringify(vaults))
    } catch (error) {
      console.warn('Failed to save vault to storage:', error)
      throw error
    }
  }

  async getVaults(): Promise<StoredVault[]> {
    try {
      const data = this.storage.getItem(STORAGE_KEYS.vaults)
      return data ? (JSON.parse(data) as StoredVault[]) : []
    } catch (error) {
      console.warn('Failed to read vaults from storage:', error)
      return []
    }
  }

  async getVault(id: string): Promise<StoredVault | null> {
    const vaults = await this.getVaults()
    return vaults.find(v => v.id === id) || null
  }

  async deleteVault(id: string): Promise<void> {
    try {
      const vaults = await this.getVaults()
      const filtered = vaults.filter(v => v.id !== id)
      this.storage.setItem(STORAGE_KEYS.vaults, JSON.stringify(filtered))

      // Clear active vault if deleting the current one
      const currentId = await this.getCurrentVaultId()
      if (currentId === id) {
        await this.setCurrentVaultId(null)
      }
    } catch (error) {
      console.warn('Failed to delete vault from storage:', error)
      throw error
    }
  }

  async clearVaults(): Promise<void> {
    try {
      this.storage.removeItem(STORAGE_KEYS.vaults)
      await this.setCurrentVaultId(null)
    } catch (error) {
      console.warn('Failed to clear vaults from storage:', error)
      throw error
    }
  }

  // ===== ACTIVE VAULT TRACKING =====

  async getCurrentVaultId(): Promise<string | null> {
    try {
      return this.storage.getItem(STORAGE_KEYS.currentVaultId)
    } catch (error) {
      console.warn('Failed to get current vault ID:', error)
      return null
    }
  }

  async setCurrentVaultId(id: string | null): Promise<void> {
    try {
      if (id === null) {
        this.storage.removeItem(STORAGE_KEYS.currentVaultId)
      } else {
        this.storage.setItem(STORAGE_KEYS.currentVaultId, id)
      }
    } catch (error) {
      console.warn('Failed to set current vault ID:', error)
    }
  }

  // ===== SETTINGS PERSISTENCE =====

  async getSettings(): Promise<Settings> {
    try {
      const data = this.storage.getItem(STORAGE_KEYS.settings)
      return data
        ? { ...DEFAULT_SETTINGS, ...(JSON.parse(data) as Partial<Settings>) }
        : DEFAULT_SETTINGS
    } catch (error) {
      console.warn('Failed to read settings from storage:', error)
      return DEFAULT_SETTINGS
    }
  }

  async saveSettings(settings: Partial<Settings>): Promise<void> {
    try {
      const current = await this.getSettings()
      const updated = { ...current, ...settings }
      this.storage.setItem(STORAGE_KEYS.settings, JSON.stringify(updated))
    } catch (error) {
      console.warn('Failed to save settings to storage:', error)
    }
  }

  // ===== UTILITY =====

  async clear(): Promise<void> {
    try {
      Object.values(STORAGE_KEYS).forEach(key => {
        this.storage.removeItem(key)
      })
    } catch (error) {
      console.warn('Failed to clear all storage:', error)
    }
  }

  /**
   * Get storage statistics
   */
  getStorageInfo(): {
    available: boolean
    vaultCount: number
    estimatedSize: string
  } {
    try {
      const vaults = this.storage.getItem(STORAGE_KEYS.vaults)
      const vaultCount = vaults ? JSON.parse(vaults).length : 0
      const approxBytes = new Blob([vaults || '']).size
      const kb = Math.round(approxBytes / 1024)

      return {
        available: true,
        vaultCount,
        estimatedSize: `${kb} KB`,
      }
    } catch {
      return {
        available: false,
        vaultCount: 0,
        estimatedSize: '0 KB',
      }
    }
  }
}
