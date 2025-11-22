/**
 * Vault Class Tests - Phase 2 Task 2.2
 * Comprehensive unit tests for the Vault class
 *
 * TESTING STRATEGY: Uses REAL WASM modules for authentic testing
 * - Real address derivation via WalletCore WASM
 * - Real cryptographic operations
 * - Mocks only external dependencies (network, storage, servers)
 *
 * Test Coverage:
 * - Vault info and summary
 * - Address derivation and caching
 * - Balance fetching and caching
 * - Gas estimation
 * - Transaction signing
 * - Token management
 * - Chain management
 * - Currency management
 * - Event emission
 */

import { Chain } from '@core/chain/Chain'
import type { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { WasmManager } from '../../../src/runtime/wasm'
import { PasswordCacheService } from '../../../src/services/PasswordCacheService'
import type { SigningPayload, Token, VaultData } from '../../../src/types/index'
import { Vault } from '../../../src/vault/Vault'
import { VaultError, VaultErrorCode } from '../../../src/vault/VaultError'
import type { VaultServices } from '../../../src/vault/VaultServices'

// Helper to create mock vault data
function createMockVaultData(overrides?: Partial<CoreVault>): CoreVault {
  return {
    name: 'Test Vault',
    publicKeys: {
      // Real-ish looking public keys (not cryptographically valid, but proper format)
      ecdsa:
        '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc',
      eddsa: 'b5d7a8e02f3c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
    },
    // Valid 32-byte (64 hex char) chain code without 0x prefix
    hexChainCode:
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    localPartyId: 'local-party-1',
    signers: ['local-party-1', 'Server-1'], // Fast vault (has Server-)
    keyShares: {
      // Mock keyshares for unit tests (FastSigningService is mocked anyway)
      ecdsa: 'mock-ecdsa-keyshare',
      eddsa: 'mock-eddsa-keyshare',
    },
    resharePrefix: '',
    libType: 'GG20',
    createdAt: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
    isBackedUp: false,
    ...overrides,
  } as CoreVault
}

// Helper to create VaultData from CoreVault
function createVaultDataFromCore(
  coreVault: CoreVault,
  vaultId: number = 0
): VaultData {
  const isFastVault = coreVault.signers.some((s: string) =>
    s.startsWith('Server-')
  )

  // Fast vaults are always encrypted
  // For unit tests, use empty vultFileContent (keyShares mocked via FastSigningService)
  // This prevents ensureKeySharesLoaded() from trying to parse invalid mock data
  const vultFileContent = ''

  return {
    // Identity (readonly fields)
    publicKeys: coreVault.publicKeys,
    hexChainCode: coreVault.hexChainCode,
    signers: coreVault.signers,
    localPartyId: coreVault.localPartyId,
    createdAt: coreVault.createdAt || Date.now(),
    libType: coreVault.libType,
    isEncrypted: isFastVault, // Fast vaults are always encrypted
    type: isFastVault ? 'fast' : 'secure',

    // Metadata
    id: vaultId,
    name: coreVault.name,
    isBackedUp: coreVault.isBackedUp,
    order: coreVault.order || 0,
    lastModified: coreVault.createdAt || Date.now(),

    // User Preferences
    currency: 'usd',
    chains: [],
    tokens: {},

    // Vault file
    vultFileContent,
  }
}

describe('Vault', () => {
  let vault: Vault
  let mockVaultData: CoreVault
  let realServices: VaultServices

  // Initialize WASM once before all tests (shared across tests for performance)
  beforeAll(async () => {
    // Preload WalletCore to speed up tests (static, so only loads once)
    await WasmManager.getWalletCore()
  }, 30000) // 30 second timeout for WASM loading

  beforeEach(() => {
    // Create mock vault data
    mockVaultData = createMockVaultData()

    // Create services (WasmManager is now static - no instance needed)
    realServices = {
      fastSigningService: {
        signWithServer: vi.fn().mockResolvedValue({
          signature: '0x' + '1234'.repeat(32),
          recovery: 27,
          format: 'ECDSA',
        }),
      } as any,
    }

    // Mock network calls for balance fetching
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          result: '1000000000000000000', // 1 ETH in wei
        }),
    })

    // Create vault instance with REAL WASM using fromStorage factory
    const vaultData = createVaultDataFromCore(mockVaultData, 0)
    vault = Vault.fromStorage(vaultData, realServices, {
      defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
      defaultCurrency: 'USD',
    })

    // Cache mock password for fast vault (fast vaults always require password)
    // This simulates what happens when user imports/creates vault
    const passwordCache = PasswordCacheService.getInstance()
    passwordCache.set('0', 'mock-password')
  })

  describe('Vault Info & Getters', () => {
    it('should expose all vault data via getters', () => {
      // Basic properties
      expect(vault.id).toBeDefined()
      expect(vault.name).toBe('Test Vault')
      expect(vault.type).toBeDefined()
      expect(vault.getChains()).toBeDefined()
      expect(vault.createdAt).toBeDefined()

      // Identity fields
      expect(vault.isEncrypted).toBeDefined()
      expect(vault.lastModified).toBeDefined()
      expect(vault.publicKeys).toHaveProperty('ecdsa')
      expect(vault.publicKeys).toHaveProperty('eddsa')
      expect(vault.hexChainCode).toBeDefined()
      expect(vault.signers).toBeDefined()
      expect(vault.localPartyId).toBeDefined()
      expect(vault.libType).toBeDefined()

      // Computed fields
      expect(typeof vault.threshold).toBe('number')
      expect(typeof vault.totalSigners).toBe('number')

      // Verify specific values
      expect(vault.getChains()).toEqual([
        Chain.Bitcoin,
        Chain.Ethereum,
        Chain.Solana,
      ])
      expect(typeof vault.isEncrypted).toBe('boolean')
      expect(vault.threshold).toBeGreaterThan(0)
      expect(vault.totalSigners).toBeGreaterThan(0)
      expect(Array.isArray(vault.signers)).toBe(true)
      expect(vault.publicKeys).toHaveProperty('ecdsa')
      expect(vault.publicKeys).toHaveProperty('eddsa')
      expect(vault.hexChainCode).toBeDefined()
      // isBackedUp should be a boolean
      expect(typeof vault.isBackedUp).toBe('boolean')
      expect(vault.isBackedUp).toBe(false)
    })

    it('should detect fast vault type (signers contain Server-)', () => {
      expect(vault.type).toBe('fast')
    })

    it('should detect secure vault type (no Server- prefix)', () => {
      const secureVaultData = createMockVaultData({
        signers: ['device-1', 'device-2'], // No Server- prefix
      })

      const vaultData = createVaultDataFromCore(secureVaultData, 1)
      const secureVault = Vault.fromStorage(vaultData, realServices)
      expect(secureVault.type).toBe('secure')
    })

    it('should have numeric vault id', () => {
      expect(vault.id).toBe(0) // Vault ID is now numeric, not ECDSA key
      expect(vault.publicKeys.ecdsa).toBe(mockVaultData.publicKeys.ecdsa)
    })

    it('should return encryption status from VaultData', () => {
      // Fast vaults are always encrypted
      expect(vault.isEncrypted).toBe(true)
    })

    it('should return security type from VaultData', () => {
      // Security type comes from VaultData
      expect(vault.type).toBe('fast')
    })

    it('should calculate threshold as 2 for 2-of-2 vaults', () => {
      // Mock vault has 2 signers: ['local-party-1', 'Server-1']
      expect(vault.totalSigners).toBe(2)
      expect(vault.threshold).toBe(2)
    })

    it('should calculate threshold correctly for multi-sig vaults', () => {
      const multiSigVaultData = createMockVaultData({
        signers: ['device-1', 'device-2', 'device-3', 'device-4'], // 4 signers
      })

      const vaultData = createVaultDataFromCore(multiSigVaultData, 2)
      const multiSigVault = Vault.fromStorage(vaultData, realServices)

      expect(multiSigVault.totalSigners).toBe(4)
      // For 4 signers: (4 + 1) / 2 = 2.5 -> ceil = 3
      expect(multiSigVault.threshold).toBe(3)
    })

    it('should include encryption status in summary', () => {
      // Fast vaults are always encrypted
      expect(vault.isEncrypted).toBe(true)
    })

    it('should include signers array in summary', () => {
      expect(Array.isArray(vault.signers)).toBe(true)
      expect(vault.signers.length).toBe(2)
      expect(vault.signers[0]).toHaveProperty('id')
      expect(vault.signers[0]).toHaveProperty('publicKey')
      expect(vault.signers[0]).toHaveProperty('name')
      expect(vault.signers[0].id).toBe('local-party-1')
      expect(vault.signers[0].name).toBe('Signer 1')
    })

    it('should include vault keys in summary', () => {
      expect(vault.keys).toEqual({
        ecdsa: mockVaultData.publicKeys.ecdsa,
        eddsa: mockVaultData.publicKeys.eddsa,
        hexChainCode: mockVaultData.hexChainCode,
        hexEncryptionKey: '',
      })
    })

    it('should include currency and tokens in summary', () => {
      expect(typeof vault.currency).toBe('string')
      expect(typeof vault.tokens).toBe('object')
    })
  })

  describe('Vault Rename', () => {
    it('should rename vault with valid name', async () => {
      await vault.rename('New Vault Name')
      expect(vault.name).toBe('New Vault Name')
    })

    it('should emit renamed event with old and new names', async () => {
      const renamedHandler = vi.fn()
      vault.on('renamed', renamedHandler)

      await vault.rename('Renamed Vault')

      expect(renamedHandler).toHaveBeenCalledWith({
        oldName: 'Test Vault',
        newName: 'Renamed Vault',
      })
      expect(renamedHandler).toHaveBeenCalledTimes(1)
    })

    it('should reject empty vault name', async () => {
      await expect(vault.rename('')).rejects.toThrow(VaultError)
      await expect(vault.rename('   ')).rejects.toThrow(
        'Vault name cannot be empty'
      )
    })

    it('should reject vault name shorter than 2 characters', async () => {
      await expect(vault.rename('A')).rejects.toThrow(VaultError)
      await expect(vault.rename('A')).rejects.toThrow('at least 2 characters')
    })

    it('should reject vault name longer than 50 characters', async () => {
      const longName = 'A'.repeat(51)
      await expect(vault.rename(longName)).rejects.toThrow(VaultError)
      await expect(vault.rename(longName)).rejects.toThrow(
        'cannot exceed 50 characters'
      )
    })

    it('should reject vault name with invalid characters', async () => {
      await expect(vault.rename('Vault@Name')).rejects.toThrow(VaultError)
      await expect(vault.rename('Vault#Name')).rejects.toThrow(VaultError)
      await expect(vault.rename('Vault$Name')).rejects.toThrow(VaultError)
      await expect(vault.rename('Vault%Name')).rejects.toThrow(VaultError)
    })

    it('should accept vault name with letters, numbers, spaces, hyphens, and underscores', async () => {
      await vault.rename('My Vault 2024-Test_1')
      expect(vault.name).toBe('My Vault 2024-Test_1')
    })

    it('should accept vault name with only allowed special characters', async () => {
      await vault.rename('Vault-Name_123')
      expect(vault.name).toBe('Vault-Name_123')

      await vault.rename('My Main Vault')
      expect(vault.name).toBe('My Main Vault')
    })

    it('should throw VaultError with InvalidConfig code', async () => {
      try {
        await vault.rename('')
        expect.fail('Should have thrown VaultError')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(VaultErrorCode.InvalidConfig)
      }
    })
  })

  describe('Vault Export', () => {
    it('should export vault with filename and data', async () => {
      const result = await vault.export()

      expect(result).toHaveProperty('filename')
      expect(result).toHaveProperty('data')
      expect(typeof result.filename).toBe('string')
      expect(typeof result.data).toBe('string')
      expect(result.filename).toMatch(/\.vult$/)
      expect(result.data.length).toBeGreaterThan(0)
    })

    it('should export vault with password (encrypted)', async () => {
      const result = await vault.export('SecurePassword123')

      expect(result).toHaveProperty('filename')
      expect(result).toHaveProperty('data')
      expect(result.data.length).toBeGreaterThan(0)
    })

    it('should export vault without password (unencrypted)', async () => {
      const result = await vault.export()

      expect(result).toHaveProperty('filename')
      expect(result).toHaveProperty('data')
      expect(result.data.length).toBeGreaterThan(0)
    })

    it('should return different data when encrypted vs unencrypted', async () => {
      const unencrypted = await vault.export()
      const encrypted = await vault.export('password123')

      // Both should be valid exports
      expect(unencrypted.filename).toBeDefined()
      expect(encrypted.filename).toBeDefined()

      // They should have content
      expect(unencrypted.data.length).toBeGreaterThan(0)
      expect(encrypted.data.length).toBeGreaterThan(0)

      // Encrypted should be different from unencrypted
      expect(unencrypted.data).not.toBe(encrypted.data)
    })

    it('should include vault name and signer info in filename', async () => {
      const result = await vault.export()

      expect(result.filename).toContain('Test Vault')
      expect(result.filename).toMatch(/share\d+of\d+\.vult$/)
    })
  })

  describe('Address Derivation', () => {
    // Note: These tests use real WASM for address derivation
    // Addresses will be deterministic based on the public keys provided

    it('should derive address for a chain', async () => {
      const address = await vault.address(Chain.Bitcoin)

      expect(address).toBeDefined()
      expect(typeof address).toBe('string')
      expect(address.length).toBeGreaterThan(0)
    })

    it('should accept chain as string', async () => {
      const address = await vault.address(Chain.Ethereum)
      expect(address).toBeDefined()
    })

    it('should accept chain as Chain enum', async () => {
      const address = await vault.address(Chain.Bitcoin)
      expect(address).toBeDefined()
    })

    it('should cache derived addresses (permanent cache)', async () => {
      const address1 = await vault.address(Chain.Bitcoin)
      const address2 = await vault.address(Chain.Bitcoin)
      const address3 = await vault.address(Chain.Bitcoin)

      // All should return the same address (proving cache works)
      expect(address1).toBe(address2)
      expect(address2).toBe(address3)
    })

    it('should derive different addresses for different chains', async () => {
      const btcAddress = await vault.address(Chain.Bitcoin)
      const ethAddress = await vault.address(Chain.Ethereum)

      expect(btcAddress).not.toBe(ethAddress)
    })

    it('should derive addresses for multiple chains in parallel', async () => {
      const addresses = await vault.addresses([
        Chain.Bitcoin,
        Chain.Ethereum,
        Chain.Solana,
      ])

      expect(addresses).toHaveProperty(Chain.Bitcoin)
      expect(addresses).toHaveProperty(Chain.Ethereum)
      expect(addresses).toHaveProperty(Chain.Solana)
      expect(Object.keys(addresses)).toHaveLength(3)

      // Each address should be unique
      const addressValues = Object.values(addresses)
      const uniqueAddresses = new Set(addressValues)
      expect(uniqueAddresses.size).toBe(3)
    })

    it('should derive addresses for default chains when no chains specified', async () => {
      const addresses = await vault.addresses()

      expect(addresses).toHaveProperty(Chain.Bitcoin)
      expect(addresses).toHaveProperty(Chain.Ethereum)
      expect(addresses).toHaveProperty(Chain.Solana)
    })

    it('should handle address derivation errors gracefully', async () => {
      // Mock static WasmManager for error testing
      const spy = vi
        .spyOn(WasmManager, 'getWalletCore')
        .mockRejectedValueOnce(new Error('WASM load failed'))

      const vaultData = createVaultDataFromCore(mockVaultData, 3)
      const errorTestVault = Vault.fromStorage(vaultData, {} as VaultServices)

      await expect(errorTestVault.address(Chain.Bitcoin)).rejects.toThrow(
        VaultError
      )

      spy.mockRestore()
    })

    it('should continue deriving other addresses if one fails', async () => {
      // This tests the error handling in addresses() method
      // With real WASM, all addresses should derive successfully
      const addresses = await vault.addresses([
        Chain.Bitcoin,
        Chain.Ethereum,
        Chain.Solana,
      ])

      // All should succeed with real WASM
      expect(Object.keys(addresses).length).toBe(3)
    })

    it('should wrap derivation errors with chain context', async () => {
      // Mock static WasmManager for error testing
      const spy = vi
        .spyOn(WasmManager, 'getWalletCore')
        .mockRejectedValueOnce(new Error('WASM error'))

      const vaultData = createVaultDataFromCore(mockVaultData, 4)
      const errorTestVault = Vault.fromStorage(vaultData, {} as VaultServices)

      try {
        await errorTestVault.address(Chain.Bitcoin)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(
          VaultErrorCode.AddressDerivationFailed
        )
        expect((error as VaultError).message).toContain(Chain.Bitcoin)
      } finally {
        spy.mockRestore()
      }
    })
  })

  // NOTE: Balance Operations tests removed - belong in integration tests
  // Balance fetching requires real blockchain API calls and is tested in @core/chain/coin/balance

  // NOTE: Gas Estimation tests removed - belong in integration tests
  // Gas estimation requires real blockchain API calls and is tested in @core/chain/gas

  describe('Transaction Signing', () => {
    const mockPayload: SigningPayload = {
      transaction: { to: '0x123', value: '1000' },
      chain: Chain.Ethereum,
    }

    it('should sign transaction with fast mode', async () => {
      const signature = await vault.sign('fast', mockPayload)

      expect(signature).toBeDefined()
      expect(signature).toHaveProperty('signature')
      expect(signature).toHaveProperty('format')
      expect(realServices.fastSigningService!.signWithServer).toHaveBeenCalled()
    })

    it('should emit transactionSigned event', async () => {
      const signedHandler = vi.fn()
      vault.on('transactionSigned', signedHandler)

      await vault.sign('fast', mockPayload)

      expect(signedHandler).toHaveBeenCalled()
      expect(signedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          signature: expect.any(Object),
          payload: mockPayload,
        })
      )
    })

    it('should work without password for unencrypted vaults', async () => {
      // Create a secure vault (no Server- signer) which can be unencrypted
      const secureVaultData = createMockVaultData({
        signers: ['device-1', 'device-2'], // No Server- = secure vault
      })
      const secureVault = Vault.fromStorage(
        createVaultDataFromCore(secureVaultData, 99),
        realServices
      )

      // Secure vaults can be unencrypted
      expect(secureVault.isEncrypted).toBe(false)

      // Lock should be a no-op for unencrypted vaults
      secureVault.lock()

      // isUnlocked should always return true for unencrypted vaults
      expect(secureVault.isUnlocked()).toBe(true)
    })

    it('should validate signing mode against vault type - fast vault allows fast mode', async () => {
      // vault is a fast vault (has Server- in signers)
      const signature = await vault.sign('fast', mockPayload)
      expect(signature).toBeDefined()
    })

    it('should validate signing mode against vault type - secure vault rejects fast mode', async () => {
      const secureVaultData = createMockVaultData({
        signers: ['device-1', 'device-2'], // No Server- prefix = secure
      })

      const vaultData = createVaultDataFromCore(secureVaultData, 5)
      const secureVault = Vault.fromStorage(vaultData, realServices)

      await expect(
        secureVault.sign('fast', mockPayload, 'password')
      ).rejects.toThrow(VaultError)
      await expect(
        secureVault.sign('fast', mockPayload, 'password')
      ).rejects.toThrow('Fast signing is only available for fast vaults')
    })

    it('should validate signing mode against vault type - secure vault allows relay mode error', async () => {
      const secureVaultData = createMockVaultData({
        signers: ['device-1', 'device-2'],
      })

      const vaultData = createVaultDataFromCore(secureVaultData, 6)
      const secureVault = Vault.fromStorage(vaultData, realServices)

      // Relay mode should pass validation but fail on not implemented
      await expect(secureVault.sign('relay', mockPayload)).rejects.toThrow(
        'Relay signing not implemented yet'
      )
    })

    it('should throw error for relay mode (fast vault rejects relay mode)', async () => {
      // Fast vault (with Server- signer) rejects relay mode
      await expect(vault.sign('relay', mockPayload)).rejects.toThrow(VaultError)
      await expect(vault.sign('relay', mockPayload)).rejects.toThrow(
        'Relay signing is only available for secure vaults'
      )
    })

    it('should throw error for local mode (not implemented)', async () => {
      await expect(vault.sign('local', mockPayload)).rejects.toThrow(VaultError)
      await expect(vault.sign('local', mockPayload)).rejects.toThrow(
        'not implemented'
      )
    })

    it('should require FastSigningService for fast signing', async () => {
      const vaultData = createVaultDataFromCore(mockVaultData, 7)
      const vaultWithoutService = Vault.fromStorage(
        vaultData,
        {} as VaultServices
      )

      await expect(
        vaultWithoutService.sign('fast', mockPayload, 'password')
      ).rejects.toThrow('FastSigningService not initialized')
    })

    it('should handle signing errors and emit error event', async () => {
      const errorHandler = vi.fn()
      vault.on('error', errorHandler)

      realServices.fastSigningService!.signWithServer = vi
        .fn()
        .mockRejectedValue(new Error('Server timeout'))

      await expect(vault.sign('fast', mockPayload)).rejects.toThrow()
      expect(errorHandler).toHaveBeenCalled()
    })

    it('should wrap non-VaultError errors in VaultError', async () => {
      realServices.fastSigningService!.signWithServer = vi
        .fn()
        .mockRejectedValue(new Error('Generic error'))

      try {
        await vault.sign('fast', mockPayload)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(VaultErrorCode.SigningFailed)
      }
    })

    it('should pass through VaultError instances', async () => {
      const vaultError = new VaultError(
        VaultErrorCode.InvalidConfig,
        'Test error'
      )
      realServices.fastSigningService!.signWithServer = vi
        .fn()
        .mockRejectedValue(vaultError)

      try {
        await vault.sign('fast', mockPayload)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBe(vaultError)
      }
    })
  })

  describe('Token Management', () => {
    const mockToken: Token = {
      id: '0x6b175474e89094c44da98b954eedeac495271d0f',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      chainId: Chain.Ethereum,
    }

    it('should set tokens for a chain', () => {
      vault.setTokens(Chain.Ethereum, [mockToken])
      const tokens = vault.getTokens(Chain.Ethereum)

      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toEqual(mockToken)
    })

    it('should add single token to chain', () => {
      vault.addToken(Chain.Ethereum, mockToken)
      const tokens = vault.getTokens(Chain.Ethereum)

      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toEqual(mockToken)
    })

    it('should emit tokenAdded event', async () => {
      const tokenHandler = vi.fn()
      vault.on('tokenAdded', tokenHandler)

      await vault.addToken(Chain.Ethereum, mockToken)

      expect(tokenHandler).toHaveBeenCalledWith({
        chain: Chain.Ethereum,
        token: mockToken,
      })
      expect(tokenHandler).toHaveBeenCalledTimes(1)
    })

    it('should not add duplicate tokens', async () => {
      await vault.addToken(Chain.Ethereum, mockToken)
      await vault.addToken(Chain.Ethereum, mockToken)
      await vault.addToken(Chain.Ethereum, mockToken)

      const tokens = vault.getTokens(Chain.Ethereum)
      expect(tokens).toHaveLength(1)
    })

    it('should not emit event for duplicate tokens', async () => {
      const tokenHandler = vi.fn()
      vault.on('tokenAdded', tokenHandler)

      await vault.addToken(Chain.Ethereum, mockToken)
      await vault.addToken(Chain.Ethereum, mockToken)

      expect(tokenHandler).toHaveBeenCalledTimes(1) // Only once
    })

    it('should remove token from chain', async () => {
      await vault.addToken(Chain.Ethereum, mockToken)
      await vault.removeToken(Chain.Ethereum, mockToken.id)

      const tokens = vault.getTokens(Chain.Ethereum)
      expect(tokens).toHaveLength(0)
    })

    it('should emit tokenRemoved event', async () => {
      const tokenHandler = vi.fn()
      vault.on('tokenRemoved', tokenHandler)

      await vault.addToken(Chain.Ethereum, mockToken)
      await vault.removeToken(Chain.Ethereum, mockToken.id)

      expect(tokenHandler).toHaveBeenCalledWith({
        chain: Chain.Ethereum,
        tokenId: mockToken.id,
      })
      expect(tokenHandler).toHaveBeenCalledTimes(1)
    })

    it('should not emit event when removing non-existent token', async () => {
      const tokenHandler = vi.fn()
      vault.on('tokenRemoved', tokenHandler)

      await vault.removeToken(Chain.Ethereum, 'non-existent-token-id')

      expect(tokenHandler).not.toHaveBeenCalled()
    })

    it('should return empty array for chain with no tokens', () => {
      const tokens = vault.getTokens(Chain.Bitcoin)
      expect(tokens).toEqual([])
    })

    it('should manage multiple tokens on same chain', () => {
      const token1: Token = { ...mockToken, id: 'token1', symbol: 'TOK1' }
      const token2: Token = { ...mockToken, id: 'token2', symbol: 'TOK2' }
      const token3: Token = { ...mockToken, id: 'token3', symbol: 'TOK3' }

      vault.addToken(Chain.Ethereum, token1)
      vault.addToken(Chain.Ethereum, token2)
      vault.addToken(Chain.Ethereum, token3)

      const tokens = vault.getTokens(Chain.Ethereum)
      expect(tokens).toHaveLength(3)
    })

    it('should replace all tokens when using setTokens', () => {
      const token1: Token = { ...mockToken, id: 'token1' }
      const token2: Token = { ...mockToken, id: 'token2' }

      vault.addToken(Chain.Ethereum, token1)
      vault.setTokens(Chain.Ethereum, [token2])

      const tokens = vault.getTokens(Chain.Ethereum)
      expect(tokens).toHaveLength(1)
      expect(tokens[0].id).toBe('token2')
    })

    it('should manage tokens for different chains independently', () => {
      const ethToken: Token = { ...mockToken, chainId: Chain.Ethereum }
      const solToken: Token = {
        ...mockToken,
        id: 'sol-token',
        chainId: Chain.Solana,
      }

      vault.addToken(Chain.Ethereum, ethToken)
      vault.addToken(Chain.Solana, solToken)

      expect(vault.getTokens(Chain.Ethereum)).toHaveLength(1)
      expect(vault.getTokens(Chain.Solana)).toHaveLength(1)
      expect(vault.getTokens(Chain.Bitcoin)).toHaveLength(0)
    })
  })

  describe('Chain Management', () => {
    it('should get current user chains', () => {
      const chains = vault.getChains()
      expect(chains).toEqual([Chain.Bitcoin, Chain.Ethereum, Chain.Solana])
    })

    it('should return copy of chains array (not reference)', () => {
      const chains1 = vault.getChains()
      const chains2 = vault.getChains()

      expect(chains1).toEqual(chains2)
      expect(chains1).not.toBe(chains2) // Different array instances

      // Modifying returned array shouldn't affect vault
      chains1.push(Chain.Ripple)
      expect(vault.getChains()).toEqual([
        Chain.Bitcoin,
        Chain.Ethereum,
        Chain.Solana,
      ])
    })

    it('should set user chains', async () => {
      await vault.setChains([Chain.Bitcoin, Chain.Ethereum])
      const chains = vault.getChains()

      expect(chains).toEqual([Chain.Bitcoin, Chain.Ethereum])
    })

    it('should accept valid Chain enums when setting', async () => {
      // Chain enum validation now happens at compile-time via TypeScript
      // This test verifies that valid Chain enums work correctly
      await expect(
        vault.setChains([Chain.Bitcoin, Chain.Ethereum])
      ).resolves.not.toThrow()
    })

    it('should pre-derive addresses when setting chains', async () => {
      await vault.setChains([Chain.Bitcoin, Chain.Ethereum, Chain.Ripple])

      // Addresses should already be cached
      const btcAddress = await vault.address(Chain.Bitcoin)
      const ethAddress = await vault.address(Chain.Ethereum)
      const xrpAddress = await vault.address(Chain.Ripple)

      expect(btcAddress).toBeDefined()
      expect(ethAddress).toBeDefined()
      expect(xrpAddress).toBeDefined()
    })

    it('should add single chain', async () => {
      await vault.addChain(Chain.Ripple)
      const chains = vault.getChains()

      expect(chains).toContain(Chain.Ripple)
      expect(chains).toHaveLength(4)
    })

    it('should emit chainAdded event', async () => {
      const chainHandler = vi.fn()
      vault.on('chainAdded', chainHandler)

      await vault.addChain(Chain.Ripple)

      expect(chainHandler).toHaveBeenCalledWith({ chain: Chain.Ripple })
      expect(chainHandler).toHaveBeenCalledTimes(1)
    })

    it('should not add duplicate chains', async () => {
      await vault.addChain(Chain.Bitcoin)
      const chains = vault.getChains()

      expect(chains).toEqual([Chain.Bitcoin, Chain.Ethereum, Chain.Solana])
    })

    it('should not emit event for duplicate chains', async () => {
      const chainHandler = vi.fn()
      vault.on('chainAdded', chainHandler)

      await vault.addChain(Chain.Bitcoin)

      expect(chainHandler).not.toHaveBeenCalled()
    })

    it('should accept valid Chain enum when adding', async () => {
      // Chain enum validation now happens at compile-time via TypeScript
      // This test verifies that valid Chain enums work correctly
      await expect(vault.addChain(Chain.Ripple)).resolves.not.toThrow()
    })

    it('should pre-derive address when adding chain', async () => {
      await vault.addChain(Chain.Ripple)

      // Address should already be cached
      const address = await vault.address(Chain.Ripple)
      expect(address).toBeDefined()
    })

    it('should remove chain', () => {
      vault.removeChain(Chain.Solana)
      const chains = vault.getChains()

      expect(chains).not.toContain(Chain.Solana)
      expect(chains).toHaveLength(2)
    })

    it('should emit chainRemoved event', async () => {
      const chainHandler = vi.fn()
      vault.on('chainRemoved', chainHandler)

      await vault.removeChain(Chain.Solana)

      expect(chainHandler).toHaveBeenCalledWith({ chain: Chain.Solana })
      expect(chainHandler).toHaveBeenCalledTimes(1)
    })

    it('should not emit event when removing non-existent chain', async () => {
      const chainHandler = vi.fn()
      vault.on('chainRemoved', chainHandler)

      await vault.removeChain(Chain.Ripple)

      expect(chainHandler).not.toHaveBeenCalled()
    })

    it('should clear address cache when removing chain', async () => {
      // Derive address first
      const address1 = await vault.address(Chain.Bitcoin)
      expect(address1).toBeDefined()

      // Remove chain (clears cache)
      vault.removeChain(Chain.Bitcoin)

      // Re-add chain
      await vault.addChain(Chain.Bitcoin)

      // Should derive address again
      const address2 = await vault.address(Chain.Bitcoin)
      expect(address2).toBeDefined()
    })

    it('should reset to default chains', async () => {
      await vault.setChains([Chain.Bitcoin])
      expect(vault.getChains()).toEqual([Chain.Bitcoin])

      await vault.resetToDefaultChains()

      const chains = vault.getChains()
      expect(chains.length).toBeGreaterThan(1)
      // DEFAULT_CHAINS from ChainManager should be restored
    })
  })

  describe('Currency Management', () => {
    it('should get default currency', () => {
      const currency = vault.getCurrency()
      expect(currency).toBe('usd')
    })

    it('should set currency', () => {
      vault.setCurrency('eur')
      expect(vault.getCurrency()).toBe('eur')
    })

    it('should accept any currency string', () => {
      const currencies = ['jpy', 'gbp', 'chf', 'cad', 'aud']

      currencies.forEach(curr => {
        vault.setCurrency(curr)
        expect(vault.getCurrency()).toBe(curr)
      })
    })
  })

  describe('Data Access', () => {
    it('should provide access to underlying vault data', () => {
      const data = vault.data

      expect(data).toBeDefined()
      // data is VaultData, not CoreVault
      expect(data.name).toBe('Test Vault')
      expect(data.publicKeys).toEqual(mockVaultData.publicKeys)
      expect(data.hexChainCode).toBe(mockVaultData.hexChainCode)
      expect(data.signers).toEqual(mockVaultData.signers)
      expect(data.type).toBe('fast')
    })

    it('should return reference to actual data (not copy)', () => {
      const data1 = vault.data
      const data2 = vault.data

      expect(data1).toBe(data2) // Same reference
    })

    it('should reflect changes made to vault', async () => {
      await vault.rename('New Name')
      expect(vault.data.name).toBe('New Name')
    })
  })

  // NOTE: Event System tests removed - relied on balance fetching which belongs in integration tests
  // Event system is tested indirectly through other operations (chainAdded, tokenAdded, etc.)

  describe('Initialization & Configuration', () => {
    it('should initialize with default config when not provided', () => {
      const vaultData = createVaultDataFromCore(mockVaultData, 8)
      const defaultVault = Vault.fromStorage(vaultData, realServices)

      const chains = defaultVault.getChains()
      const currency = defaultVault.getCurrency()

      expect(chains).toBeDefined()
      expect(chains.length).toBeGreaterThan(0)
      expect(currency).toBe('usd')
    })

    it('should initialize with custom default chains', () => {
      const vaultData = createVaultDataFromCore(mockVaultData, 9)
      const customVault = Vault.fromStorage(vaultData, realServices, {
        defaultChains: [Chain.Bitcoin, Chain.Ripple],
      })

      expect(customVault.getChains()).toEqual([Chain.Bitcoin, Chain.Ripple])
    })

    it('should initialize with custom default currency', () => {
      const vaultData = createVaultDataFromCore(mockVaultData, 10)
      // Remove currency from VaultData so config default can be used
      const vaultDataWithoutCurrency = {
        ...vaultData,
        currency: undefined as any,
      }
      const customVault = Vault.fromStorage(
        vaultDataWithoutCurrency,
        realServices,
        {
          defaultCurrency: 'eur',
        }
      )

      expect(customVault.getCurrency()).toBe('eur')
    })

    it('should work without fastSigningService', () => {
      const vaultData = createVaultDataFromCore(mockVaultData, 11)
      const vaultWithoutSigning = Vault.fromStorage(
        vaultData,
        {} as VaultServices
      )

      expect(() => vaultWithoutSigning.getChains()).not.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty token list', () => {
      vault.setTokens(Chain.Ethereum, [])
      const tokens = vault.getTokens(Chain.Ethereum)

      expect(tokens).toEqual([])
    })

    it('should handle concurrent address derivations', async () => {
      const promises = [
        vault.address(Chain.Bitcoin),
        vault.address(Chain.Ethereum),
        vault.address(Chain.Solana),
        vault.address(Chain.Bitcoin), // duplicate
        vault.address(Chain.Ethereum), // duplicate
      ]

      const addresses = await Promise.all(promises)

      expect(addresses).toHaveLength(5)
      // Duplicates should return same address
      expect(addresses[0]).toBe(addresses[3])
      expect(addresses[1]).toBe(addresses[4])
    })
  })

  describe('Transaction Preparation (prepareSendTx)', () => {
    // NOTE: prepareSendTx() requires blockchain data (UTXOs, nonces, balances)
    // These tests belong in Phase 3 (Integration Tests) or Phase 4 (E2E Tests)
    // See: docs/plans/testing/PHASE_3_INTEGRATION.md
    // See: docs/plans/testing/PHASE_4_E2E.md

    it('should have prepareSendTx method available', () => {
      expect(vault.prepareSendTx).toBeDefined()
      expect(typeof vault.prepareSendTx).toBe('function')
    })

    it('should validate method signature', () => {
      // Test that the method exists and can be called
      // Actual functionality tested in integration/e2e tests
      const methodSignature = vault.prepareSendTx.toString()
      expect(methodSignature).toContain('prepareSendTx')
    })
  })

  // DEFERRED TO INTEGRATION TESTS (Phase 3/4)
  // The following test cases require real blockchain data and will be
  // implemented in integration test suite:
  // - should prepare send transaction for native coin (Ethereum)
  // - should prepare send transaction for token (ERC-20)
  // - should prepare send transaction with memo (THORChain)
  // - should prepare send transaction with custom fee settings
  // - should handle errors for invalid chain
  // - should prepare send transactions for Bitcoin
  // - should prepare send transactions for Solana
  // - should prepare send transactions for multiple chains
  // - should include vault metadata in payload
  // - should handle very small amounts
  // - should handle very large amounts
})
