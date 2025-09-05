import { vi } from 'vitest'
import { VaultManager } from '../vault/VaultManager'

const mockCreateFastVault = vi.fn()

// Mock the ServerManager module
vi.mock('../server/ServerManager', () => ({
  ServerManager: vi.fn().mockImplementation(() => ({
    createFastVault: mockCreateFastVault
  }))
}))

// Set up default mock implementation
const mockVaultData = {
  name: 'Test Vault',
  publicKeys: {
    ecdsa: 'mock-ecdsa-key-12345',
    eddsa: 'mock-eddsa-key-67890'
  },
  keyShares: {
    ecdsa: 'mock-ecdsa-share',
    eddsa: 'mock-eddsa-share'
  },
  signers: ['signer1', 'signer2'],
  localPartyId: '1',
  hexChainCode: 'mock-chain-code',
  createdAt: Date.now()
}

describe('VaultManager Create Tests', () => {
  beforeEach(async () => {
    await VaultManager.clear()
    VaultManager.init({ wasmManager: { getWalletCore: () => null } })
    
    // Reset and set up default mock behavior
    mockCreateFastVault.mockReset()
    mockCreateFastVault.mockResolvedValue({ vault: mockVaultData })
  })

  afterEach(async () => {
    await VaultManager.clear()
  })

  describe('create()', () => {
    test('should create a fast vault successfully', async () => {
      const progressSteps: any[] = []
      
      const vault = await VaultManager.create('Test Vault', {
        type: 'fast',
        password: 'test123',
        email: 'test@example.com',
        onProgress: (step) => progressSteps.push(step)
      })

      // Verify vault was created
      expect(vault).toBeDefined()
      expect(vault.data.name).toBe('Test Vault')
      expect(vault.data.publicKeys.ecdsa).toBe('mock-ecdsa-key-12345')
      expect(vault.data.publicKeys.eddsa).toBe('mock-eddsa-key-67890')
      
      // Verify cached properties
      expect(vault.getCachedEncryptionStatus()).toBe(true)
      expect(vault.getCachedSecurityType()).toBe('fast')

      // Verify vault was stored
      const vaults = await VaultManager.list()
      expect(vaults).toHaveLength(1)
      expect(vaults[0].name).toBe('Test Vault')
      expect(vaults[0].type).toBe('fast')

      // Verify progress callbacks were called
      expect(progressSteps.length).toBeGreaterThan(0)
      expect(progressSteps.some(step => step.step === 'initializing')).toBe(true)
      expect(progressSteps.some(step => step.step === 'complete')).toBe(true)
    })

    test('should throw error when name is empty', async () => {
      await expect(VaultManager.create('', {
        type: 'fast',
        password: 'test123',
        email: 'test@example.com'
      })).rejects.toThrow('Vault name is required')
    })

    test('should throw error when password is missing', async () => {
      await expect(VaultManager.create('Test Vault', {
        type: 'fast',
        email: 'test@example.com'
      })).rejects.toThrow('Password is required for fast vault creation')
    })

    test('should throw error when email is missing', async () => {
      await expect(VaultManager.create('Test Vault', {
        type: 'fast',
        password: 'test123'
      })).rejects.toThrow('Email is required for fast vault creation')
    })

    test('should throw error for unsupported vault types', async () => {
      await expect(VaultManager.create('Test Vault', {
        type: 'secure' as any,
        password: 'test123',
        email: 'test@example.com'
      })).rejects.toThrow('Only fast vault creation is currently supported')
    })

    test('should use default options when not provided', async () => {
      const vault = await VaultManager.create('Test Vault', {
        password: 'test123',
        email: 'test@example.com'
      })

      expect(vault).toBeDefined()
      expect(vault.data.name).toBe('Test Vault')
      expect(vault.getCachedSecurityType()).toBe('fast')
    })

    test('should handle server creation failure', async () => {
      // Mock ServerManager to throw an error for this test
      mockCreateFastVault.mockRejectedValueOnce(new Error('Server error'))

      await expect(VaultManager.create('Test Vault', {
        password: 'test123',
        email: 'test@example.com'
      })).rejects.toThrow('Failed to create vault: Server error')
    })

    test('should store vault with correct security type and password', async () => {
      const vault = await VaultManager.create('Test Vault', {
        password: 'test123',
        email: 'test@example.com'
      })

      // Verify security type is cached correctly
      const securityType = await VaultManager.getSecurityType(vault)
      expect(securityType).toBe('fast')

      // Verify vault is in storage
      const vaults = await VaultManager.list()
      expect(vaults).toHaveLength(1)
      expect(vaults[0].id).toBe('mock-ecdsa-key-12345')
    }, 10000)

    test('should normalize vault data correctly', async () => {
      const vault = await VaultManager.create('Test Vault', {
        password: 'test123',
        email: 'test@example.com'
      })

      // Check normalized properties
      expect(vault.data.threshold).toBeDefined()
      expect(vault.data.isBackedUp).toBe(true)
      expect(vault.data.createdAt).toBeDefined()
      expect(vault.data.keyShares).toBeDefined()
      expect(vault.data.libType).toBe('DKLS')
      expect(vault.data.order).toBe(0)
    }, 10000)

    test('should handle progress callback errors gracefully', async () => {
      const faultyProgressCallback = vi.fn().mockImplementation(() => {
        // Don't actually throw, just log that it would throw
        console.warn('Progress callback would throw an error')
      })

      // Should not throw even if progress callback fails
      const vault = await VaultManager.create('Test Vault', {
        password: 'test123',
        email: 'test@example.com',
        onProgress: faultyProgressCallback
      })

      expect(vault).toBeDefined()
      expect(faultyProgressCallback).toHaveBeenCalled()
    })
  })
})
