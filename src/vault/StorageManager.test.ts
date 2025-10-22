import { describe, expect, test, beforeEach, afterEach } from 'vitest'

import { StorageManager, type StoredVault, type Settings } from './StorageManager'

describe('StorageManager', () => {
  let storage: StorageManager

  beforeEach(() => {
    storage = new StorageManager()
  })

  afterEach(async () => {
    await storage.clear()
  })

  describe('Vault Operations', () => {
    test('should save and retrieve a vault', async () => {
      const vault: StoredVault = {
        id: 'test-vault-1',
        name: 'Test Vault',
        size: 1024,
        encrypted: true,
        dateAdded: Date.now(),
        containerBase64: 'base64content',
      }

      await storage.saveVault(vault)
      const retrieved = await storage.getVault('test-vault-1')

      expect(retrieved).toMatchObject(vault)
    })

    test('should update existing vault', async () => {
      const vault: StoredVault = {
        id: 'test-vault-1',
        name: 'Test Vault',
        size: 1024,
        encrypted: true,
        dateAdded: Date.now(),
      }

      await storage.saveVault(vault)

      const updated: StoredVault = {
        ...vault,
        name: 'Updated Vault',
        containerBase64: 'newbase64',
      }

      await storage.saveVault(updated)

      const retrieved = await storage.getVault('test-vault-1')
      expect(retrieved?.name).toBe('Updated Vault')
      expect(retrieved?.containerBase64).toBe('newbase64')
    })

    test('should list all vaults', async () => {
      const vault1: StoredVault = {
        id: 'vault-1',
        name: 'Vault 1',
        encrypted: true,
        dateAdded: Date.now(),
      }

      const vault2: StoredVault = {
        id: 'vault-2',
        name: 'Vault 2',
        encrypted: false,
        dateAdded: Date.now(),
      }

      await storage.saveVault(vault1)
      await storage.saveVault(vault2)

      const vaults = await storage.getVaults()
      expect(vaults).toHaveLength(2)
      expect(vaults.find(v => v.id === 'vault-1')).toBeTruthy()
      expect(vaults.find(v => v.id === 'vault-2')).toBeTruthy()
    })

    test('should delete a vault', async () => {
      const vault: StoredVault = {
        id: 'vault-to-delete',
        name: 'Delete Me',
        encrypted: false,
        dateAdded: Date.now(),
      }

      await storage.saveVault(vault)
      expect(await storage.getVault('vault-to-delete')).toBeTruthy()

      await storage.deleteVault('vault-to-delete')
      expect(await storage.getVault('vault-to-delete')).toBeNull()
    })

    test('should clear all vaults', async () => {
      const vault1: StoredVault = {
        id: 'vault-1',
        name: 'Vault 1',
        encrypted: true,
        dateAdded: Date.now(),
      }

      const vault2: StoredVault = {
        id: 'vault-2',
        name: 'Vault 2',
        encrypted: false,
        dateAdded: Date.now(),
      }

      await storage.saveVault(vault1)
      await storage.saveVault(vault2)

      await storage.clearVaults()

      const vaults = await storage.getVaults()
      expect(vaults).toHaveLength(0)
    })

    test('should return null for non-existent vault', async () => {
      const vault = await storage.getVault('non-existent')
      expect(vault).toBeNull()
    })
  })

  describe('Active Vault Tracking', () => {
    test('should set and get current vault ID', async () => {
      await storage.setCurrentVaultId('vault-123')
      const id = await storage.getCurrentVaultId()
      expect(id).toBe('vault-123')
    })

    test('should clear current vault ID', async () => {
      await storage.setCurrentVaultId('vault-123')
      await storage.setCurrentVaultId(null)
      const id = await storage.getCurrentVaultId()
      expect(id).toBeNull()
    })

    test('should clear current vault ID when deleting that vault', async () => {
      const vault: StoredVault = {
        id: 'active-vault',
        name: 'Active Vault',
        encrypted: false,
        dateAdded: Date.now(),
      }

      await storage.saveVault(vault)
      await storage.setCurrentVaultId('active-vault')

      await storage.deleteVault('active-vault')

      const currentId = await storage.getCurrentVaultId()
      expect(currentId).toBeNull()
    })

    test('should clear current vault ID when clearing all vaults', async () => {
      await storage.setCurrentVaultId('vault-123')
      await storage.clearVaults()

      const currentId = await storage.getCurrentVaultId()
      expect(currentId).toBeNull()
    })
  })

  describe('Settings Persistence', () => {
    test('should return default settings when none exist', async () => {
      const settings = await storage.getSettings()
      expect(settings).toEqual({
        defaultCurrency: 'USD',
        defaultChains: ['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple'],
        isBalanceVisible: true,
      })
    })

    test('should save and retrieve settings', async () => {
      const newSettings: Settings = {
        defaultCurrency: 'EUR',
        defaultChains: ['Bitcoin', 'Ethereum'],
        isBalanceVisible: false,
      }

      await storage.saveSettings(newSettings)
      const retrieved = await storage.getSettings()

      expect(retrieved).toEqual(newSettings)
    })

    test('should partially update settings', async () => {
      await storage.saveSettings({
        defaultCurrency: 'EUR',
      })

      const settings = await storage.getSettings()
      expect(settings.defaultCurrency).toBe('EUR')
      expect(settings.defaultChains).toEqual(['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple'])
      expect(settings.isBalanceVisible).toBe(true)
    })
  })

  describe('Storage Info', () => {
    test('should return storage statistics', async () => {
      const vault1: StoredVault = {
        id: 'vault-1',
        name: 'Vault 1',
        encrypted: true,
        dateAdded: Date.now(),
        containerBase64: 'a'.repeat(1000),
      }

      const vault2: StoredVault = {
        id: 'vault-2',
        name: 'Vault 2',
        encrypted: false,
        dateAdded: Date.now(),
        containerBase64: 'b'.repeat(1000),
      }

      await storage.saveVault(vault1)
      await storage.saveVault(vault2)

      const info = storage.getStorageInfo()
      expect(info.available).toBe(true)
      expect(info.vaultCount).toBe(2)
      expect(info.estimatedSize).toMatch(/\d+ KB/)
    })

    test('should handle empty storage', () => {
      const info = storage.getStorageInfo()
      expect(info.available).toBe(true)
      expect(info.vaultCount).toBe(0)
    })
  })

  describe('Clear All', () => {
    test('should clear all storage including vaults, active vault, and settings', async () => {
      const vault: StoredVault = {
        id: 'vault-1',
        name: 'Vault 1',
        encrypted: true,
        dateAdded: Date.now(),
      }

      await storage.saveVault(vault)
      await storage.setCurrentVaultId('vault-1')
      await storage.saveSettings({ defaultCurrency: 'EUR' })

      await storage.clear()

      const vaults = await storage.getVaults()
      const currentId = await storage.getCurrentVaultId()
      const settings = await storage.getSettings()

      expect(vaults).toHaveLength(0)
      expect(currentId).toBeNull()
      expect(settings.defaultCurrency).toBe('USD') // Should be default
    })
  })
})

