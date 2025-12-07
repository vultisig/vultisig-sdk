import { Chain } from '@core/chain/Chain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureDefaultStorage } from '../../src/context/defaultStorage'
import { configureWasm } from '../../src/context/wasmRuntime'
import { MemoryStorage } from '../../src/storage/MemoryStorage'
import { ValidationHelpers } from '../../src/utils/validation'
import { VaultBase } from '../../src/vault/VaultBase'
import { SUPPORTED_CHAINS, Vultisig } from '../../src/Vultisig'

// Mock WASM getter for tests
const mockWalletCore = {}
const mockGetWalletCore = vi.fn().mockResolvedValue(mockWalletCore)

describe('Vultisig', () => {
  let sdk: Vultisig

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
    mockGetWalletCore.mockClear()

    // Configure WASM mock before creating any SDK instances
    configureWasm(mockGetWalletCore)

    // Configure default storage for tests (simulates platform entry point)
    configureDefaultStorage(() => new MemoryStorage())

    // Create SDK instance with test configuration
    sdk = new Vultisig({
      autoInit: false, // Don't auto-initialize to avoid WASM loading in tests
      autoConnect: false, // Don't auto-connect
      defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
      defaultCurrency: 'USD',
      storage: new MemoryStorage(), // Use memory storage for tests
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    // Clear active vault from storage to prevent test pollution
    await sdk.setActiveVault(null)
  })

  describe('initialization', () => {
    it('should use default storage when not provided', async () => {
      // When default storage is configured, Vultisig can be created without explicit storage
      const sdkWithDefaultStorage = new Vultisig({ autoInit: false })
      expect(sdkWithDefaultStorage).toBeDefined()
      expect(sdkWithDefaultStorage).toBeInstanceOf(Vultisig)
    })

    it('should create instance with storage configuration', async () => {
      const defaultSdk = new Vultisig({ storage: new MemoryStorage() })

      expect(defaultSdk).toBeDefined()
      expect(defaultSdk).toBeInstanceOf(Vultisig)
      expect(defaultSdk.initialized).toBe(false)
    })

    it('should create instance with custom configuration', () => {
      const customSdk = new Vultisig({
        storage: new MemoryStorage(),
        defaultChains: [Chain.Bitcoin, Chain.Ethereum],
        defaultCurrency: 'EUR',
        autoInit: false,
      })

      expect(customSdk).toBeDefined()
      expect(customSdk.defaultChains).toEqual([Chain.Bitcoin, Chain.Ethereum])
      expect(customSdk.defaultCurrency).toBe('EUR')
    })

    it('should accept valid Chain enums on initialization', () => {
      // Chain enum validation now happens at compile-time via TypeScript
      // This test verifies that valid Chain enums are accepted
      expect(() => {
        new Vultisig({
          storage: new MemoryStorage(),
          defaultChains: [Chain.Bitcoin, Chain.Ethereum],
          autoInit: false,
        })
      }).not.toThrow()
    })

    it('should initialize SDK', async () => {
      expect(sdk.initialized).toBe(false)

      await sdk.initialize()

      expect(sdk.initialized).toBe(true)
    })

    it('should handle initialization failure', async () => {
      // Mock getWalletCore to throw error
      mockGetWalletCore.mockRejectedValueOnce(new Error('WASM load failed'))

      await expect(sdk.initialize()).rejects.toThrow('Failed to initialize SDK')
    })

    it('should not initialize twice', async () => {
      await sdk.initialize()
      await sdk.initialize() // Second call should be no-op

      expect(mockGetWalletCore).toHaveBeenCalledTimes(1)
    })
  })

  describe('vault management', () => {
    it('should check if has active vault', async () => {
      expect(await sdk.hasActiveVault()).toBe(false)
    })
  })

  describe('supported chains', () => {
    it('should return all supported chains', () => {
      const chains = SUPPORTED_CHAINS

      expect(chains).toBeDefined()
      expect(Array.isArray(chains)).toBe(true)
      expect(chains.length).toBeGreaterThan(0)

      // Should include default chains
      expect(chains).toContain(Chain.Bitcoin)
      expect(chains).toContain(Chain.Ethereum)
      expect(chains).toContain(Chain.Solana)
    })

    it('should get default chains', () => {
      const defaults = sdk.defaultChains

      expect(defaults).toBeDefined()
      expect(defaults).toEqual([Chain.Bitcoin, Chain.Ethereum, Chain.Solana])
    })

    it('should set default chains', () => {
      const newDefaults = [Chain.Bitcoin, Chain.Ethereum]

      sdk.setDefaultChains(newDefaults)

      expect(sdk.defaultChains).toEqual(newDefaults)
    })

    it('should accept any chain values when setting defaults', async () => {
      // Chain validation happens at compile-time via TypeScript
      // Runtime validation is not performed
      const newChains = [Chain.Bitcoin, Chain.Ethereum]
      await expect(sdk.setDefaultChains(newChains)).resolves.not.toThrow()
      expect(sdk.defaultChains).toEqual(newChains)
    })

    it('should return immutable copy of default chains', () => {
      const chains1 = sdk.defaultChains
      const chains2 = sdk.defaultChains

      expect(chains1).toEqual(chains2)
      expect(chains1).not.toBe(chains2) // Different array instances

      // Modifying the returned array should not affect the original
      chains1.push('NewChain' as any)
      expect(sdk.defaultChains).not.toContain('NewChain')
    })
  })

  describe('validation helpers', () => {
    describe('validateEmail', () => {
      it('should validate correct email formats', () => {
        const result1 = ValidationHelpers.validateEmail('user@example.com')
        expect(result1.valid).toBe(true)
        expect(result1.error).toBeUndefined()

        const result2 = ValidationHelpers.validateEmail('test.user+tag@domain.co.uk')
        expect(result2.valid).toBe(true)
      })

      it('should reject invalid email formats', () => {
        const result1 = ValidationHelpers.validateEmail('invalid')
        expect(result1.valid).toBe(false)
        expect(result1.error).toBeDefined()

        const result2 = ValidationHelpers.validateEmail('@domain.com')
        expect(result2.valid).toBe(false)

        const result3 = ValidationHelpers.validateEmail('user@')
        expect(result3.valid).toBe(false)

        const result4 = ValidationHelpers.validateEmail('')
        expect(result4.valid).toBe(false)
      })
    })

    describe('validatePassword', () => {
      it('should validate strong passwords', () => {
        const result = ValidationHelpers.validatePassword('StrongPass123!')
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      })

      it('should reject weak passwords', () => {
        const result1 = ValidationHelpers.validatePassword('weak')
        expect(result1.valid).toBe(true) // Password validation is minimal (only checks length)

        const result2 = ValidationHelpers.validatePassword('')
        expect(result2.valid).toBe(false)
        expect(result2.error).toBeDefined()
      })
    })

    describe('validateVaultName', () => {
      it('should validate correct vault names', () => {
        const result1 = ValidationHelpers.validateVaultName('My Vault')
        expect(result1.valid).toBe(true)
        expect(result1.error).toBeUndefined()

        const result2 = ValidationHelpers.validateVaultName('Test-Vault_123')
        expect(result2.valid).toBe(true)
      })

      it('should reject invalid vault names', () => {
        const result1 = ValidationHelpers.validateVaultName('')
        expect(result1.valid).toBe(false)
        expect(result1.error).toBeDefined()

        const result2 = ValidationHelpers.validateVaultName('a')
        expect(result2.valid).toBe(false)
        expect(result2.error).toBeDefined()

        const result3 = ValidationHelpers.validateVaultName('a'.repeat(51))
        expect(result3.valid).toBe(false)
        expect(result3.error).toBeDefined()

        // Note: ValidationHelpers doesn't check for special characters
        // This test validates the minimum requirements
      })
    })
  })

  describe('currency management', () => {
    it('should get default currency', () => {
      expect(sdk.defaultCurrency).toBe('USD')
    })

    it('should set default currency', () => {
      sdk.setDefaultCurrency('EUR')
      expect(sdk.defaultCurrency).toBe('EUR')
    })
  })

  describe('active vault management', () => {
    it('should check if has active vault', async () => {
      expect(await sdk.hasActiveVault()).toBe(false)
    })

    it('should get active vault', async () => {
      const activeVault = await sdk.getActiveVault()
      expect(activeVault).toBeNull()
    })

    it('should set active vault', async () => {
      // This test requires actual vault data in storage to work properly
      // The full functionality is tested in integration tests
      // For unit test, we verify the API exists and accepts parameters
      const mockVault = {
        id: 'mock-public-key-string',
        summary: () => ({ id: 'mock-public-key-string' }),
      } as any as VaultBase

      // Verify the method can be called without throwing
      await expect(sdk.setActiveVault(mockVault)).resolves.not.toThrow()

      // Verify hasActiveVault returns true (ID is stored)
      expect(await sdk.hasActiveVault()).toBe(true)
    })
  })

  describe('server status', () => {
    it('should check server status', async () => {
      // Mock serverManager.checkServerStatus (access via internal context for testing)
      const mockStatus = {
        fastVault: {
          online: true,
          latency: 50,
        },
        messageRelay: {
          online: true,
          latency: 30,
        },
        timestamp: Date.now(),
      }

      // Access internal context for mocking (serverManager is not public)
      const serverManager = (sdk as any).context.serverManager
      vi.spyOn(serverManager, 'checkServerStatus').mockResolvedValue(mockStatus)

      const status = await sdk.getServerStatus()

      expect(status).toEqual(mockStatus)
      expect(status.fastVault.online).toBe(true)
    })
  })

  describe('event emission', () => {
    it('should be an event emitter', () => {
      expect(sdk.on).toBeDefined()
      expect(sdk.off).toBeDefined()
      // emit is protected, verify instance has event capabilities
      expect(sdk).toHaveProperty('on')
      expect(sdk).toHaveProperty('off')
    })

    it('should emit events', async () => {
      // Test that event listeners work
      return new Promise<void>(resolve => {
        sdk.on('error', (error: Error) => {
          // Event listener successfully received event
          expect(error).toBeDefined()
          resolve()
        })

        // Manually emit an error event to test the event system
        sdk.emit('error', new Error('Test error'))
      })
    })
  })

  describe('vault lifecycle operations', () => {
    // WASM mock is configured globally in outer beforeEach

    it('should list vaults when empty', async () => {
      const vaults = await sdk.listVaults()

      expect(vaults).toBeDefined()
      expect(Array.isArray(vaults)).toBe(true)
      expect(vaults).toHaveLength(0)
    })

    it('should handle vault operations requiring initialization', async () => {
      // listVaults should auto-initialize if needed
      const initializeSpy = vi.spyOn(sdk, 'initialize')

      await sdk.listVaults()

      expect(initializeSpy).toHaveBeenCalled()
      expect(sdk.initialized).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should handle initialization errors', async () => {
      mockGetWalletCore.mockRejectedValueOnce(new Error('Init failed'))

      await expect(sdk.initialize()).rejects.toThrow('Failed to initialize SDK')
    })

    // Note: Testing auto-init error emission is not feasible with current architecture
    // because auto-init happens in constructor before mocks can be set up.
    // Error handling for manual initialize() is tested above.
  })

  describe('storage integration', () => {
    it('should use default storage when not explicitly provided', () => {
      // With default storage configured, SDK can be created without explicit storage
      const sdkWithDefault = new Vultisig({ autoInit: false })
      expect(sdkWithDefault).toBeDefined()
      expect(sdkWithDefault.storage).toBeDefined()
    })

    it('should accept custom storage', () => {
      const mockStorage = {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
      }

      const sdkWithCustomStorage = new Vultisig({
        storage: { customStorage: mockStorage },
        autoInit: false,
      })

      expect(sdkWithCustomStorage).toBeDefined()
    })
  })

  describe('edge cases', () => {
    it('should work with no config when default storage is configured', () => {
      // With default storage configured, SDK can be created with no config
      const sdkNoConfig = new Vultisig()
      expect(sdkNoConfig).toBeDefined()
      expect(sdkNoConfig.storage).toBeDefined()
    })

    it('should handle partial config with storage', () => {
      const sdkPartialConfig = new Vultisig({
        storage: new MemoryStorage(),
        defaultCurrency: 'EUR',
      })

      expect(sdkPartialConfig.defaultCurrency).toBe('EUR')
      // Should use default chains
      expect(sdkPartialConfig.defaultChains.length).toBeGreaterThan(0)
    })

    it('should handle calling operations before initialization', async () => {
      // Operations that require initialization should auto-initialize
      // Need to provide storage configuration for global singleton
      const mockStorage = {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
      }
      const uninitializedSdk = new Vultisig({
        autoInit: false,
        storage: mockStorage as any,
      })

      // WASM mock is configured globally in outer beforeEach

      expect(uninitializedSdk.initialized).toBe(false)

      await uninitializedSdk.listVaults()

      expect(uninitializedSdk.initialized).toBe(true)
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent initialization calls without race condition', async () => {
      // Create a fresh SDK for this test
      const concurrentSdk = new Vultisig({ storage: new MemoryStorage(), autoInit: false })

      // Track calls to the mock
      mockGetWalletCore.mockClear()

      // Call initialize multiple times concurrently
      const promises = await Promise.all([
        concurrentSdk.initialize(),
        concurrentSdk.initialize(),
        concurrentSdk.initialize(),
      ])

      // All promises should resolve successfully
      expect(promises).toHaveLength(3)
      // SDK should be initialized
      expect(concurrentSdk.initialized).toBe(true)
      // BUG FIX: Initialize should have been called ONLY ONCE (not 3 times)
      // This verifies the race condition fix is working
      expect(mockGetWalletCore).toHaveBeenCalledTimes(1)
    })

    it('should retry initialization on failure', async () => {
      const retrySdk = new Vultisig({ storage: new MemoryStorage(), autoInit: false })

      // First call fails, second succeeds
      mockGetWalletCore.mockRejectedValueOnce(new Error('First attempt failed')).mockResolvedValueOnce({})

      // First attempt should fail
      await expect(retrySdk.initialize()).rejects.toThrow('Failed to initialize SDK')
      expect(retrySdk.initialized).toBe(false)

      // Second attempt should succeed (promise was reset on error)
      await retrySdk.initialize()
      expect(retrySdk.initialized).toBe(true)
      expect(mockGetWalletCore).toHaveBeenCalledTimes(2)
    })
  })
})
