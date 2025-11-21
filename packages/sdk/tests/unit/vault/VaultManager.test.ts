/**
 * VaultManager Tests - Phase 2 Task 2.3
 * Comprehensive unit tests for the VaultManager class
 *
 * TESTING STRATEGY: Tests vault lifecycle management
 * - Vault creation (fast/secure)
 * - Import/export operations
 * - Vault storage and retrieval
 * - Active vault management
 * - Error handling and edge cases
 *
 * Test Coverage:
 * - Vault creation and initialization
 * - Import from .vult files (encrypted/unencrypted)
 * - Vault listing and retrieval
 * - Active vault management
 * - Vault deletion
 * - Error scenarios and validation
 */

import { Chain } from '@core/chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryStorage } from '../../../src/runtime/storage/MemoryStorage'
import { ServerManager } from '../../../src/server/ServerManager'
import {
  VaultImportError,
  VaultImportErrorCode,
} from '../../../src/vault/VaultError'
import { VaultManager } from '../../../src/VaultManager'

// Mock modules
vi.mock('@lib/utils/file/initiateFileDownload', () => ({
  initiateFileDownload: vi.fn(),
}))

describe('VaultManager', () => {
  let vaultManager: VaultManager
  let mockServerManager: ServerManager

  beforeEach(() => {
    // Create mock dependencies
    mockServerManager = {
      createFastVault: vi.fn().mockResolvedValue({
        vault: {
          name: 'Fast Vault',
          publicKeys: {
            ecdsa: '02test_ecdsa_key',
            eddsa: 'test_eddsa_key',
          },
          hexChainCode: 'test_chain_code',
          localPartyId: 'local-1',
          signers: ['local-1', 'Server-1'],
          keyShares: { ecdsa: 'mock_ecdsa', eddsa: 'mock_eddsa' },
          resharePrefix: '',
          libType: 'GG20',
          createdAt: Date.now(),
          isBackedUp: false,
          order: 0,
        } as Vault,
        sessionId: 'test-session-id',
      }),
    } as any

    vaultManager = new VaultManager(
      mockServerManager,
      {
        defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
        defaultCurrency: 'USD',
      },
      new MemoryStorage()
    )
  })

  // ===== VAULT CREATION =====

  describe('createFastVault', () => {
    it('should create a fast vault by default', async () => {
      const { vault } = await vaultManager.createFastVault('Test Fast Vault', {
        email: 'test@example.com',
        password: 'SecurePassword123!',
      })

      expect(vault).toBeDefined()
      expect(vault.data.name).toBe('Fast Vault')
      expect(mockServerManager.createFastVault).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Fast Vault',
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })
      )
    })

    it('should set newly created vault as active', async () => {
      await vaultManager.createFastVault('Fast Vault', {
        email: 'test@example.com',
        password: 'pass123',
      })

      const activeVault = await vaultManager.getActiveVault()
      expect(activeVault).toBeDefined()
      expect(activeVault?.name).toBe('Fast Vault')
      expect(activeVault).not.toBeNull()
    })

    it('should call onProgressInternal callback during creation', async () => {
      const onProgressInternal = vi.fn()

      await vaultManager.createFastVault('Progress Vault', {
        email: 'test@example.com',
        password: 'pass123',
        onProgressInternal,
      })

      // Verify onProgressInternal was called with vault reference
      expect(onProgressInternal).toHaveBeenCalled()

      // Verify it was passed to ServerManager
      expect(mockServerManager.createFastVault).toHaveBeenCalledWith(
        expect.objectContaining({
          onProgress: expect.any(Function),
        })
      )
    })

    it('should report all VaultCreationStep phases with vault reference', async () => {
      const progressSteps: Array<{ step: any; vault?: any }> = []
      const onProgressInternal = vi.fn((step, vault) => {
        progressSteps.push({ step, vault })
      })

      // Mock ServerManager to simulate keygen progress
      mockServerManager.createFastVault = vi
        .fn()
        .mockImplementation(options => {
          // Simulate keygen progress callbacks
          if (options.onProgress) {
            options.onProgress({ phase: 'ecdsa', message: 'ECDSA keygen' })
            options.onProgress({ phase: 'eddsa', message: 'EdDSA keygen' })
            options.onProgress({ phase: 'complete', message: 'Keygen done' })
          }
          return Promise.resolve({
            vault: {
              name: 'Fast Vault',
              publicKeys: { ecdsa: '02test', eddsa: 'test' },
              hexChainCode: 'test',
              localPartyId: 'local-1',
              signers: ['local-1', 'Server-1'],
              keyShares: { ecdsa: 'mock', eddsa: 'mock' },
              resharePrefix: '',
              libType: 'GG20',
              createdAt: Date.now(),
              isBackedUp: false,
              order: 0,
            },
            sessionId: 'test-session',
          })
        })

      await vaultManager.createFastVault('Progress Vault', {
        email: 'test@example.com',
        password: 'pass123',
        onProgressInternal,
      })

      // Verify all expected steps were reported
      const reportedSteps = progressSteps.map(s => s.step.step)
      expect(reportedSteps).toContain('initializing')
      expect(reportedSteps).toContain('keygen')
      expect(reportedSteps).toContain('deriving_addresses')
      expect(reportedSteps).toContain('fetching_balances')
      expect(reportedSteps).toContain('applying_tokens')
      expect(reportedSteps).toContain('complete')

      // Verify progress values are increasing
      const progressValues = progressSteps.map(s => s.step.progress)
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1])
      }

      // Verify final progress is 100%
      expect(progressSteps[progressSteps.length - 1].step.progress).toBe(100)
      expect(progressSteps[progressSteps.length - 1].step.step).toBe('complete')

      // Verify vault reference is undefined early, then populated
      const earlySteps = progressSteps.filter(s =>
        ['initializing', 'keygen'].includes(s.step.step)
      )
      const laterSteps = progressSteps.filter(s =>
        [
          'deriving_addresses',
          'fetching_balances',
          'applying_tokens',
          'complete',
        ].includes(s.step.step)
      )

      // Early steps should have undefined vault
      earlySteps.forEach(s => {
        expect(s.vault).toBeUndefined()
      })

      // Later steps should have vault reference
      laterSteps.forEach(s => {
        expect(s.vault).toBeDefined()
      })
    })

    it('should provide descriptive messages in progress updates', async () => {
      const progressSteps: any[] = []
      const onProgressInternal = vi.fn(step => {
        progressSteps.push(step)
      })

      await vaultManager.createFastVault('Progress Vault', {
        email: 'test@example.com',
        password: 'pass123',
        onProgressInternal,
      })

      // Verify all steps have messages
      progressSteps.forEach(step => {
        expect(step.message).toBeDefined()
        expect(typeof step.message).toBe('string')
        expect(step.message.length).toBeGreaterThan(0)
      })
    })
  })

  describe('createSecureVault', () => {
    it('should throw error for secure vault creation (not implemented)', async () => {
      await expect(
        vaultManager.createSecureVault('Secure Vault')
      ).rejects.toThrow('Secure vault creation not implemented yet')
    })
  })

  // ===== VAULT IMPORT =====
  // NOTE: Comprehensive import tests with real vault files are in E2E tests
  // These unit tests only verify error handling for corrupted data

  describe('importVault', () => {
    it('should reject corrupted files', async () => {
      const corruptedContent = 'corrupted data'

      await expect(vaultManager.importVault(corruptedContent)).rejects.toThrow(
        VaultImportError
      )
    })

    it('should throw VaultImportError with correct error code', async () => {
      const badContent = 'bad'

      try {
        await vaultManager.importVault(badContent)
        expect.fail('Should have thrown VaultImportError')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultImportError)
        expect((error as VaultImportError).code).toBe(
          VaultImportErrorCode.CORRUPTED_DATA
        )
      }
    })
  })

  // ===== VAULT LISTING =====

  describe('listVaults', () => {
    it('should return empty array when no vaults exist', async () => {
      const vaults = await vaultManager.listVaults()
      expect(vaults).toEqual([])
    })

    it('should list all created vaults', async () => {
      // Create two vaults
      await vaultManager.createFastVault('Vault 1', {
        email: 'test1@example.com',
        password: 'pass1',
      })

      // Modify mock to return different vault for second call
      mockServerManager.createFastVault = vi.fn().mockResolvedValue({
        vault: {
          name: 'Vault 2',
          publicKeys: {
            ecdsa: '02different_ecdsa_key',
            eddsa: 'different_eddsa_key',
          },
          hexChainCode: 'different_chain_code',
          localPartyId: 'local-2',
          signers: ['local-2', 'Server-2'],
          keyShares: { ecdsa: 'mock_ecdsa2', eddsa: 'mock_eddsa2' },
          resharePrefix: '',
          libType: 'GG20',
          createdAt: Date.now(),
          isBackedUp: false,
          order: 1,
        } as Vault,
        sessionId: 'test-session-id-2',
      })

      await vaultManager.createFastVault('Vault 2', {
        email: 'test2@example.com',
        password: 'pass2',
      })

      const vaults = await vaultManager.listVaults()

      expect(vaults).toHaveLength(2)
      expect(vaults[0].name).toBe('Fast Vault')
      expect(vaults[1].name).toBe('Vault 2')
    })

    it('should return vault instances with accessible metadata', async () => {
      await vaultManager.createFastVault('Metadata Vault', {
        email: 'test@example.com',
        password: 'pass',
      })

      const vaults = await vaultManager.listVaults()
      const vault = vaults[0]

      // Verify it's a Vault instance with methods
      expect(typeof vault.balance).toBe('function')
      expect(typeof vault.address).toBe('function')

      // Verify vault properties are accessible
      expect(vault).toHaveProperty('id')
      expect(vault).toHaveProperty('name')
      expect(vault).toHaveProperty('type')
      expect(vault).toHaveProperty('createdAt')
      expect(vault).toHaveProperty('isBackedUp')

      // Verify vault data is accessible
      expect(vault).toHaveProperty('signers')
      expect(vault.signers.length).toBeGreaterThan(0)
    })

    it('should include correct threshold for 2-of-2 vaults', async () => {
      await vaultManager.createFastVault('2-of-2 Vault', {
        email: 'test@example.com',
        password: 'pass',
      })

      const vaults = await vaultManager.listVaults()
      const vault = vaults[0]

      // Verify it's a 2-of-2 vault (2 signers)
      expect(vault.signers.length).toBe(2)
      // If threshold is set, it should be 2
      if (vault.threshold !== undefined) {
        expect(vault.threshold).toBe(2)
      }
    })
  })

  // ===== VAULT DELETION =====

  describe('deleteVault', () => {
    it('should delete a vault', async () => {
      const { vault } = await vaultManager.createFastVault('To Delete', {
        email: 'test@example.com',
        password: 'pass',
      })

      await vaultManager.deleteVault(vault.id)

      const vaults = await vaultManager.listVaults()
      expect(vaults).toHaveLength(0)
    })

    it('should clear active vault if deleted vault was active', async () => {
      const { vault } = await vaultManager.createFastVault('Active To Delete', {
        email: 'test@example.com',
        password: 'pass',
      })

      expect(await vaultManager.getActiveVault()).toBeDefined()

      await vaultManager.deleteVault(vault.id)

      expect(await vaultManager.getActiveVault()).toBeNull()
    })

    it('should not affect active vault if different vault is deleted', async () => {
      const { vault: vault1 } = await vaultManager.createFastVault('Vault 1', {
        email: 'test1@example.com',
        password: 'pass1',
      })

      mockServerManager.createFastVault = vi.fn().mockResolvedValue({
        vault: {
          name: 'Vault 2',
          publicKeys: {
            ecdsa: '02different_key',
            eddsa: 'different_key',
          },
          hexChainCode: 'different',
          localPartyId: 'local-2',
          signers: ['local-2', 'Server-2'],
          keyShares: { ecdsa: 'mock_ecdsa3', eddsa: 'mock_eddsa3' },
          resharePrefix: '',
          libType: 'GG20',
          createdAt: Date.now(),
          isBackedUp: false,
          order: 1,
        } as Vault,
        sessionId: 'session-2',
      })

      await vaultManager.createFastVault('Vault 2', {
        email: 'test2@example.com',
        password: 'pass2',
      })

      // Vault 2 is active after creation
      await vaultManager.deleteVault(vault1.id)

      const activeVault = await vaultManager.getActiveVault()
      expect(activeVault).toBeDefined()
      expect(activeVault?.name).toBe('Vault 2')
    })
  })

  describe('clearVaults', () => {
    it('should remove all vaults', async () => {
      await vaultManager.createFastVault('Vault 1', {
        email: 'test@example.com',
        password: 'pass',
      })

      await vaultManager.clearVaults()

      const vaults = await vaultManager.listVaults()
      expect(vaults).toHaveLength(0)
    })

    it('should clear active vault', async () => {
      await vaultManager.createFastVault('Active', {
        email: 'test@example.com',
        password: 'pass',
      })

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

    it('should set active vault', async () => {
      const { vault } = await vaultManager.createFastVault('Active', {
        email: 'test@example.com',
        password: 'pass',
      })

      await vaultManager.setActiveVault(vault.id)

      expect(await vaultManager.hasActiveVault()).toBe(true)
      expect((await vaultManager.getActiveVault())?.id).toBe(vault.id)
    })

    it('should switch between vaults', async () => {
      const { vault: vault1 } = await vaultManager.createFastVault('Vault 1', {
        email: 'test1@example.com',
        password: 'pass1',
      })

      mockServerManager.createFastVault = vi.fn().mockResolvedValue({
        vault: {
          name: 'Vault 2',
          publicKeys: {
            ecdsa: '02vault2_key',
            eddsa: 'vault2_key',
          },
          hexChainCode: 'vault2',
          localPartyId: 'local-2',
          signers: ['local-2', 'Server-2'],
          keyShares: { ecdsa: 'mock_ecdsa4', eddsa: 'mock_eddsa4' },
          resharePrefix: '',
          libType: 'GG20',
          createdAt: Date.now(),
          isBackedUp: false,
          order: 1,
        } as Vault,
        sessionId: 'session-2',
      })

      const { vault: vault2 } = await vaultManager.createFastVault('Vault 2', {
        email: 'test2@example.com',
        password: 'pass2',
      })

      await vaultManager.setActiveVault(vault1.id)
      expect((await vaultManager.getActiveVault())?.name).toBe('Fast Vault')

      await vaultManager.setActiveVault(vault2.id)
      expect((await vaultManager.getActiveVault())?.name).toBe('Vault 2')
    })
  })

  // ===== FILE OPERATIONS =====
  // NOTE: File encryption detection with real vault files is tested in E2E tests
  // isVaultContentEncrypted returns false for parseable content, only throws for
  // completely unparseable data. Comprehensive testing in E2E suite.

  // ===== EDGE CASES =====

  describe('edge cases', () => {
    it('should create VaultClass instance with proper dependencies', async () => {
      const { vault } = await vaultManager.createFastVault('Test', {
        email: 'test@example.com',
        password: 'pass',
      })

      // Verify vault has access to services
      expect(vault).toBeDefined()
      expect(vault.data).toBeDefined()
    })
  })
})
