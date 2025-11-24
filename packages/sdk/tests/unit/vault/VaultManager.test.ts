/**
 * VaultManager Tests - Updated for Global Singletons Architecture
 * Comprehensive unit tests for the VaultManager class
 *
 * TESTING STRATEGY: Tests vault lifecycle management
 * - Import/export operations
 * - Vault storage and retrieval
 * - Active vault management
 * - Error handling and edge cases
 *
 * NOTE: Vault creation is now handled by FastVault.create() static method
 * and is tested separately.
 *
 * Test Coverage:
 * - Import from .vult files (encrypted/unencrypted)
 * - Vault listing and retrieval
 * - Active vault management
 * - Vault deletion
 * - Error scenarios and validation
 */

import { Chain } from '@core/chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GlobalConfig } from '../../../src/config/GlobalConfig'
import { GlobalStorage } from '../../../src/runtime/storage/GlobalStorage'
import { MemoryStorage } from '../../../src/runtime/storage/MemoryStorage'
import { GlobalServerManager } from '../../../src/server/GlobalServerManager'
import { PasswordCacheService } from '../../../src/services/PasswordCacheService'
import { VaultImportError, VaultImportErrorCode } from '../../../src/vault/VaultError'
import { VaultManager } from '../../../src/VaultManager'

// Mock modules
vi.mock('@lib/utils/file/initiateFileDownload', () => ({
  initiateFileDownload: vi.fn(),
}))

describe('VaultManager', () => {
  let vaultManager: VaultManager
  let memoryStorage: MemoryStorage

  beforeEach(() => {
    // Reset all global singletons before each test
    GlobalStorage.reset()
    GlobalServerManager.reset()
    GlobalConfig.reset()
    PasswordCacheService.resetInstance()

    // Configure global singletons
    memoryStorage = new MemoryStorage()
    GlobalStorage.configure({ customStorage: memoryStorage })

    GlobalServerManager.configure({
      fastVault: 'https://test-api.vultisig.com/vault',
      messageRelay: 'https://test-api.vultisig.com/router',
    })

    GlobalConfig.configure({
      defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
      defaultCurrency: 'USD',
    })

    // Create VaultManager (no parameters needed)
    vaultManager = new VaultManager()
  })

  // ===== VAULT IMPORT =====
  // NOTE: Comprehensive import tests with real vault files are in E2E tests
  // These unit tests only verify error handling for corrupted data

  describe('importVault', () => {
    it('should reject corrupted files', async () => {
      const corruptedContent = 'corrupted data'

      await expect(vaultManager.importVault(corruptedContent)).rejects.toThrow(VaultImportError)
    })

    it('should throw VaultImportError with correct error code', async () => {
      const badContent = 'bad'

      try {
        await vaultManager.importVault(badContent)
        expect.fail('Should have thrown VaultImportError')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultImportError)
        expect((error as VaultImportError).code).toBe(VaultImportErrorCode.CORRUPTED_DATA)
      }
    })
  })

  // ===== VAULT LISTING =====

  describe('listVaults', () => {
    it('should return empty array when no vaults exist', async () => {
      const vaults = await vaultManager.listVaults()
      expect(vaults).toEqual([])
    })
  })

  // ===== VAULT RETRIEVAL =====

  describe('getVaultById', () => {
    it('should return null for non-existent vault', async () => {
      const vault = await vaultManager.getVaultById('nonexistent_public_key_string')
      expect(vault).toBeNull()
    })
  })

  describe('getAllVaults', () => {
    it('should return empty array when no vaults exist', async () => {
      const vaults = await vaultManager.getAllVaults()
      expect(vaults).toEqual([])
    })
  })

  // ===== VAULT DELETION =====

  describe('deleteVault', () => {
    it('should throw error when deleting non-existent vault', async () => {
      const nonExistentId = 'nonexistent_public_key_string'
      await expect(vaultManager.deleteVault(nonExistentId)).rejects.toThrow(`Vault ${nonExistentId} not found`)
    })
  })

  describe('clearVaults', () => {
    it('should not throw when clearing empty vault list', async () => {
      await expect(vaultManager.clearVaults()).resolves.not.toThrow()
    })

    it('should clear active vault even when no vaults exist', async () => {
      await vaultManager.clearVaults()
      expect(await vaultManager.getActiveVault()).toBeNull()
    })
  })

  // ===== ACTIVE VAULT MANAGEMENT =====

  describe('active vault management', () => {
    it('should have no active vault initially', async () => {
      expect(await vaultManager.hasActiveVault()).toBe(false)
      expect(await vaultManager.getActiveVault()).toBeNull()
    })

    it('should allow setting active vault to null', async () => {
      await vaultManager.setActiveVault(null)
      expect(await vaultManager.hasActiveVault()).toBe(false)
    })

    it('should return null when getting active vault with no active vault', async () => {
      const activeVault = await vaultManager.getActiveVault()
      expect(activeVault).toBeNull()
    })
  })

  // ===== FILE OPERATIONS =====
  // NOTE: File encryption detection with real vault files is tested in E2E tests
  // isVaultContentEncrypted returns false for parseable content, only throws for
  // completely unparseable data. Comprehensive testing in E2E suite.

  describe('isVaultContentEncrypted', () => {
    it('should throw VaultImportError for completely invalid content', async () => {
      const invalidContent = 'not-base64-or-valid-vault-data'

      await expect(vaultManager.isVaultContentEncrypted(invalidContent)).rejects.toThrow(VaultImportError)
    })
  })

  // ===== FACTORY METHOD =====

  describe('createVaultInstance', () => {
    it('should be callable (internal method)', () => {
      expect(typeof vaultManager.createVaultInstance).toBe('function')
    })
  })
})
