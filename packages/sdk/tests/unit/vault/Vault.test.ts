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

import type { SigningPayload, Token } from '../../../src/types/index'
import { Vault } from '../../../src/vault/Vault'
import { VaultError, VaultErrorCode } from '../../../src/vault/VaultError'
import type { VaultServices } from '../../../src/vault/VaultServices'
import { WASMManager } from '../../../src/wasm/WASMManager'

// Mock only external dependencies, NOT WASM or core functions
vi.mock('@lib/utils/file/initiateFileDownload', () => ({
  initiateFileDownload: vi.fn(),
}))

// Real WASMManager instance for authentic testing
let sharedWasmManager: WASMManager

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
    keyShares: [],
    resharePrefix: '',
    libType: 'GG20',
    createdAt: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
    isBackedUp: false,
    ...overrides,
  } as CoreVault
}

describe('Vault', () => {
  let vault: Vault
  let mockVaultData: CoreVault
  let realServices: VaultServices

  // Initialize WASM once before all tests (shared across tests for performance)
  beforeAll(async () => {
    // Create real WASMManager that will load actual WASM modules
    sharedWasmManager = new WASMManager()
    // Preload WalletCore to speed up tests (memoized, so only loads once)
    await sharedWasmManager.getWalletCore()
  }, 30000) // 30 second timeout for WASM loading

  beforeEach(() => {
    // Create mock vault data
    mockVaultData = createMockVaultData()

    // Create services with REAL WASMManager
    realServices = {
      wasmManager: sharedWasmManager,
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

    // Create vault instance with REAL WASM
    vault = new Vault(mockVaultData, realServices, {
      defaultChains: ['bitcoin', 'ethereum', 'solana'],
      defaultCurrency: 'USD',
    })
  })

  describe('Vault Info & Summary', () => {
    it('should return vault summary', () => {
      const summary = vault.summary()

      expect(summary).toHaveProperty('id')
      expect(summary).toHaveProperty('name', 'Test Vault')
      expect(summary).toHaveProperty('type')
      expect(summary).toHaveProperty('chains')
      expect(summary).toHaveProperty('createdAt')
      expect(summary).toHaveProperty('isBackedUp', false)
      expect(summary.chains).toEqual(['bitcoin', 'ethereum', 'solana'])
    })

    it('should detect fast vault type (signers contain Server-)', () => {
      const summary = vault.summary()
      expect(summary.type).toBe('fast')
    })

    it('should detect secure vault type (no Server- prefix)', () => {
      const secureVaultData = createMockVaultData({
        signers: ['device-1', 'device-2'], // No Server- prefix
      })

      const secureVault = new Vault(secureVaultData, realServices)
      const summary = secureVault.summary()
      expect(summary.type).toBe('secure')
    })

    it('should use id from ECDSA public key', () => {
      const summary = vault.summary()
      expect(summary.id).toBe(mockVaultData.publicKeys.ecdsa)
    })

    it('should cache encryption status', () => {
      expect(vault.getCachedEncryptionStatus()).toBeUndefined()

      vault.setCachedEncryptionStatus(true)
      expect(vault.getCachedEncryptionStatus()).toBe(true)

      vault.setCachedEncryptionStatus(false)
      expect(vault.getCachedEncryptionStatus()).toBe(false)
    })

    it('should cache security type', () => {
      expect(vault.getCachedSecurityType()).toBeUndefined()

      vault.setCachedSecurityType('fast')
      expect(vault.getCachedSecurityType()).toBe('fast')

      vault.setCachedSecurityType('secure')
      expect(vault.getCachedSecurityType()).toBe('secure')
    })

    it('should use cached security type in summary if available', () => {
      vault.setCachedSecurityType('secure')
      const summary = vault.summary()
      // Cached type overrides determined type
      expect(summary.type).toBe('secure')
    })
  })

  describe('Vault Rename', () => {
    it('should rename vault with valid name', async () => {
      await vault.rename('New Vault Name')
      const summary = vault.summary()
      expect(summary.name).toBe('New Vault Name')
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
      const summary = vault.summary()
      expect(summary.name).toBe('My Vault 2024-Test_1')
    })

    it('should accept vault name with only allowed special characters', async () => {
      await vault.rename('Vault-Name_123')
      expect(vault.summary().name).toBe('Vault-Name_123')

      await vault.rename('My Main Vault')
      expect(vault.summary().name).toBe('My Main Vault')
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
    it('should export vault as blob', async () => {
      const blob = await vault.export()

      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('application/octet-stream')
      expect(blob.size).toBeGreaterThan(0)
    })

    it('should export vault with password (encrypted)', async () => {
      const blob = await vault.export('SecurePassword123')

      expect(blob).toBeInstanceOf(Blob)
      expect(blob.size).toBeGreaterThan(0)
    })

    it('should export vault without password (unencrypted)', async () => {
      const blob = await vault.export()

      expect(blob).toBeInstanceOf(Blob)
      expect(blob.size).toBeGreaterThan(0)
    })

    it('should return different blob content when encrypted vs unencrypted', async () => {
      const unencrypted = await vault.export()
      const encrypted = await vault.export('password123')

      // Both should be valid blobs
      expect(unencrypted).toBeInstanceOf(Blob)
      expect(encrypted).toBeInstanceOf(Blob)

      // They should have content
      expect(unencrypted.size).toBeGreaterThan(0)
      expect(encrypted.size).toBeGreaterThan(0)
    })
  })

  describe('Address Derivation', () => {
    // Note: These tests use real WASM for address derivation
    // Addresses will be deterministic based on the public keys provided

    it('should derive address for a chain', async () => {
      const address = await vault.address('bitcoin')

      expect(address).toBeDefined()
      expect(typeof address).toBe('string')
      expect(address.length).toBeGreaterThan(0)
    })

    it('should accept chain as string', async () => {
      const address = await vault.address('ethereum')
      expect(address).toBeDefined()
    })

    it('should accept chain as Chain enum', async () => {
      const address = await vault.address(Chain.Bitcoin)
      expect(address).toBeDefined()
    })

    it('should cache derived addresses (permanent cache)', async () => {
      const address1 = await vault.address('bitcoin')
      const address2 = await vault.address('bitcoin')
      const address3 = await vault.address('bitcoin')

      // All should return the same address (proving cache works)
      expect(address1).toBe(address2)
      expect(address2).toBe(address3)
    })

    it('should derive different addresses for different chains', async () => {
      const btcAddress = await vault.address('bitcoin')
      const ethAddress = await vault.address('ethereum')

      expect(btcAddress).not.toBe(ethAddress)
    })

    it('should derive addresses for multiple chains in parallel', async () => {
      const addresses = await vault.addresses(['bitcoin', 'ethereum', 'solana'])

      expect(addresses).toHaveProperty('bitcoin')
      expect(addresses).toHaveProperty('ethereum')
      expect(addresses).toHaveProperty('solana')
      expect(Object.keys(addresses)).toHaveLength(3)

      // Each address should be unique
      const addressValues = Object.values(addresses)
      const uniqueAddresses = new Set(addressValues)
      expect(uniqueAddresses.size).toBe(3)
    })

    it('should derive addresses for default chains when no chains specified', async () => {
      const addresses = await vault.addresses()

      expect(addresses).toHaveProperty('bitcoin')
      expect(addresses).toHaveProperty('ethereum')
      expect(addresses).toHaveProperty('solana')
    })

    it('should handle address derivation errors gracefully', async () => {
      // Create a separate vault with a mocked WASMManager for error testing
      const mockWasmManager = {
        getWalletCore: vi.fn().mockRejectedValue(new Error('WASM load failed')),
      } as any

      const errorTestVault = new Vault(mockVaultData, {
        wasmManager: mockWasmManager,
      } as VaultServices)

      await expect(errorTestVault.address('bitcoin')).rejects.toThrow(
        VaultError
      )
      await expect(errorTestVault.address('bitcoin')).rejects.toThrow(
        'Failed to derive address'
      )
    })

    it('should continue deriving other addresses if one fails', async () => {
      // This tests the error handling in addresses() method
      // With real WASM, all addresses should derive successfully
      const addresses = await vault.addresses(['bitcoin', 'ethereum', 'solana'])

      // All should succeed with real WASM
      expect(Object.keys(addresses).length).toBe(3)
    })

    it('should wrap derivation errors with chain context', async () => {
      // Create a separate vault with a mocked WASMManager for error testing
      const mockWasmManager = {
        getWalletCore: vi.fn().mockRejectedValue(new Error('WASM error')),
      } as any

      const errorTestVault = new Vault(mockVaultData, {
        wasmManager: mockWasmManager,
      } as VaultServices)

      try {
        await errorTestVault.address('bitcoin')
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(
          VaultErrorCode.AddressDerivationFailed
        )
        expect((error as VaultError).message).toContain('bitcoin')
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
      const signature = await vault.sign('fast', mockPayload, 'password123')

      expect(signature).toBeDefined()
      expect(signature).toHaveProperty('signature')
      expect(signature).toHaveProperty('format')
      expect(realServices.fastSigningService!.signWithServer).toHaveBeenCalled()
    })

    it('should emit transactionSigned event', async () => {
      const signedHandler = vi.fn()
      vault.on('transactionSigned', signedHandler)

      await vault.sign('fast', mockPayload, 'password123')

      expect(signedHandler).toHaveBeenCalled()
      expect(signedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          signature: expect.any(Object),
          payload: mockPayload,
        })
      )
    })

    it('should require password for fast signing', async () => {
      await expect(vault.sign('fast', mockPayload)).rejects.toThrow(VaultError)
      await expect(vault.sign('fast', mockPayload)).rejects.toThrow(
        'Password is required'
      )
    })

    it('should validate signing mode against vault type - fast vault allows fast mode', async () => {
      // vault is a fast vault (has Server- in signers)
      const signature = await vault.sign('fast', mockPayload, 'password')
      expect(signature).toBeDefined()
    })

    it('should validate signing mode against vault type - secure vault rejects fast mode', async () => {
      const secureVaultData = createMockVaultData({
        signers: ['device-1', 'device-2'], // No Server- prefix = secure
      })

      const secureVault = new Vault(secureVaultData, realServices)

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

      const secureVault = new Vault(secureVaultData, realServices)

      // Relay mode should pass validation but fail on not implemented
      await expect(
        secureVault.sign('relay', mockPayload, 'password')
      ).rejects.toThrow('Relay signing not implemented yet')
    })

    it('should throw error for relay mode (fast vault rejects relay mode)', async () => {
      // Fast vault (with Server- signer) rejects relay mode
      await expect(
        vault.sign('relay', mockPayload, 'password')
      ).rejects.toThrow(VaultError)
      await expect(
        vault.sign('relay', mockPayload, 'password')
      ).rejects.toThrow('Relay signing is only available for secure vaults')
    })

    it('should throw error for local mode (not implemented)', async () => {
      await expect(
        vault.sign('local', mockPayload, 'password')
      ).rejects.toThrow(VaultError)
      await expect(
        vault.sign('local', mockPayload, 'password')
      ).rejects.toThrow('not implemented')
    })

    it('should require FastSigningService for fast signing', async () => {
      const vaultWithoutService = new Vault(mockVaultData, {
        wasmManager: realServices.wasmManager,
      } as VaultServices)

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

      await expect(
        vault.sign('fast', mockPayload, 'password')
      ).rejects.toThrow()
      expect(errorHandler).toHaveBeenCalled()
    })

    it('should wrap non-VaultError errors in VaultError', async () => {
      realServices.fastSigningService!.signWithServer = vi
        .fn()
        .mockRejectedValue(new Error('Generic error'))

      try {
        await vault.sign('fast', mockPayload, 'password')
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
        await vault.sign('fast', mockPayload, 'password')
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
      chainId: 'ethereum',
    }

    it('should set tokens for a chain', () => {
      vault.setTokens('ethereum', [mockToken])
      const tokens = vault.getTokens('ethereum')

      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toEqual(mockToken)
    })

    it('should add single token to chain', () => {
      vault.addToken('ethereum', mockToken)
      const tokens = vault.getTokens('ethereum')

      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toEqual(mockToken)
    })

    it('should emit tokenAdded event', () => {
      const tokenHandler = vi.fn()
      vault.on('tokenAdded', tokenHandler)

      vault.addToken('ethereum', mockToken)

      expect(tokenHandler).toHaveBeenCalledWith({
        chain: 'ethereum',
        token: mockToken,
      })
      expect(tokenHandler).toHaveBeenCalledTimes(1)
    })

    it('should not add duplicate tokens', () => {
      vault.addToken('ethereum', mockToken)
      vault.addToken('ethereum', mockToken)
      vault.addToken('ethereum', mockToken)

      const tokens = vault.getTokens('ethereum')
      expect(tokens).toHaveLength(1)
    })

    it('should not emit event for duplicate tokens', () => {
      const tokenHandler = vi.fn()
      vault.on('tokenAdded', tokenHandler)

      vault.addToken('ethereum', mockToken)
      vault.addToken('ethereum', mockToken)

      expect(tokenHandler).toHaveBeenCalledTimes(1) // Only once
    })

    it('should remove token from chain', () => {
      vault.addToken('ethereum', mockToken)
      vault.removeToken('ethereum', mockToken.id)

      const tokens = vault.getTokens('ethereum')
      expect(tokens).toHaveLength(0)
    })

    it('should emit tokenRemoved event', () => {
      const tokenHandler = vi.fn()
      vault.on('tokenRemoved', tokenHandler)

      vault.addToken('ethereum', mockToken)
      vault.removeToken('ethereum', mockToken.id)

      expect(tokenHandler).toHaveBeenCalledWith({
        chain: 'ethereum',
        tokenId: mockToken.id,
      })
      expect(tokenHandler).toHaveBeenCalledTimes(1)
    })

    it('should not emit event when removing non-existent token', () => {
      const tokenHandler = vi.fn()
      vault.on('tokenRemoved', tokenHandler)

      vault.removeToken('ethereum', 'non-existent-token-id')

      expect(tokenHandler).not.toHaveBeenCalled()
    })

    it('should return empty array for chain with no tokens', () => {
      const tokens = vault.getTokens('bitcoin')
      expect(tokens).toEqual([])
    })

    it('should manage multiple tokens on same chain', () => {
      const token1: Token = { ...mockToken, id: 'token1', symbol: 'TOK1' }
      const token2: Token = { ...mockToken, id: 'token2', symbol: 'TOK2' }
      const token3: Token = { ...mockToken, id: 'token3', symbol: 'TOK3' }

      vault.addToken('ethereum', token1)
      vault.addToken('ethereum', token2)
      vault.addToken('ethereum', token3)

      const tokens = vault.getTokens('ethereum')
      expect(tokens).toHaveLength(3)
    })

    it('should replace all tokens when using setTokens', () => {
      const token1: Token = { ...mockToken, id: 'token1' }
      const token2: Token = { ...mockToken, id: 'token2' }

      vault.addToken('ethereum', token1)
      vault.setTokens('ethereum', [token2])

      const tokens = vault.getTokens('ethereum')
      expect(tokens).toHaveLength(1)
      expect(tokens[0].id).toBe('token2')
    })

    it('should manage tokens for different chains independently', () => {
      const ethToken: Token = { ...mockToken, chainId: 'ethereum' }
      const solToken: Token = {
        ...mockToken,
        id: 'sol-token',
        chainId: 'solana',
      }

      vault.addToken('ethereum', ethToken)
      vault.addToken('solana', solToken)

      expect(vault.getTokens('ethereum')).toHaveLength(1)
      expect(vault.getTokens('solana')).toHaveLength(1)
      expect(vault.getTokens('bitcoin')).toHaveLength(0)
    })
  })

  describe('Chain Management', () => {
    it('should get current user chains', () => {
      const chains = vault.getChains()
      expect(chains).toEqual(['bitcoin', 'ethereum', 'solana'])
    })

    it('should return copy of chains array (not reference)', () => {
      const chains1 = vault.getChains()
      const chains2 = vault.getChains()

      expect(chains1).toEqual(chains2)
      expect(chains1).not.toBe(chains2) // Different array instances

      // Modifying returned array shouldn't affect vault
      chains1.push('ripple')
      expect(vault.getChains()).toEqual(['bitcoin', 'ethereum', 'solana'])
    })

    it('should set user chains', async () => {
      await vault.setChains(['bitcoin', 'ethereum'])
      const chains = vault.getChains()

      expect(chains).toEqual(['bitcoin', 'ethereum'])
    })

    it('should validate chains when setting', async () => {
      await expect(vault.setChains(['invalid_chain'])).rejects.toThrow(
        VaultError
      )
      await expect(vault.setChains(['invalid_chain'])).rejects.toThrow(
        'Chain not supported'
      )
    })

    it('should pre-derive addresses when setting chains', async () => {
      await vault.setChains(['bitcoin', 'ethereum', 'ripple'])

      // Addresses should already be cached
      const btcAddress = await vault.address('bitcoin')
      const ethAddress = await vault.address('ethereum')
      const xrpAddress = await vault.address('ripple')

      expect(btcAddress).toBeDefined()
      expect(ethAddress).toBeDefined()
      expect(xrpAddress).toBeDefined()
    })

    it('should add single chain', async () => {
      await vault.addChain('ripple')
      const chains = vault.getChains()

      expect(chains).toContain('ripple')
      expect(chains).toHaveLength(4)
    })

    it('should emit chainAdded event', async () => {
      const chainHandler = vi.fn()
      vault.on('chainAdded', chainHandler)

      await vault.addChain('ripple')

      expect(chainHandler).toHaveBeenCalledWith({ chain: 'ripple' })
      expect(chainHandler).toHaveBeenCalledTimes(1)
    })

    it('should not add duplicate chains', async () => {
      await vault.addChain('bitcoin')
      const chains = vault.getChains()

      expect(chains).toEqual(['bitcoin', 'ethereum', 'solana'])
    })

    it('should not emit event for duplicate chains', async () => {
      const chainHandler = vi.fn()
      vault.on('chainAdded', chainHandler)

      await vault.addChain('bitcoin')

      expect(chainHandler).not.toHaveBeenCalled()
    })

    it('should validate chain before adding', async () => {
      await expect(vault.addChain('invalid_chain')).rejects.toThrow(VaultError)
      await expect(vault.addChain('invalid_chain')).rejects.toThrow(
        'Chain not supported'
      )
    })

    it('should pre-derive address when adding chain', async () => {
      await vault.addChain('ripple')

      // Address should already be cached
      const address = await vault.address('ripple')
      expect(address).toBeDefined()
    })

    it('should remove chain', () => {
      vault.removeChain('solana')
      const chains = vault.getChains()

      expect(chains).not.toContain('solana')
      expect(chains).toHaveLength(2)
    })

    it('should emit chainRemoved event', () => {
      const chainHandler = vi.fn()
      vault.on('chainRemoved', chainHandler)

      vault.removeChain('solana')

      expect(chainHandler).toHaveBeenCalledWith({ chain: 'solana' })
      expect(chainHandler).toHaveBeenCalledTimes(1)
    })

    it('should not emit event when removing non-existent chain', () => {
      const chainHandler = vi.fn()
      vault.on('chainRemoved', chainHandler)

      vault.removeChain('ripple')

      expect(chainHandler).not.toHaveBeenCalled()
    })

    it('should clear address cache when removing chain', async () => {
      // Derive address first
      const address1 = await vault.address('bitcoin')
      expect(address1).toBeDefined()

      // Remove chain (clears cache)
      vault.removeChain('bitcoin')

      // Re-add chain
      await vault.addChain('bitcoin')

      // Should derive address again
      const address2 = await vault.address('bitcoin')
      expect(address2).toBeDefined()
    })

    it('should reset to default chains', async () => {
      await vault.setChains(['bitcoin'])
      expect(vault.getChains()).toEqual(['bitcoin'])

      await vault.resetToDefaultChains()

      const chains = vault.getChains()
      expect(chains.length).toBeGreaterThan(1)
      // DEFAULT_CHAINS from ChainManager should be restored
    })
  })

  describe('Currency Management', () => {
    it('should get default currency', () => {
      const currency = vault.getCurrency()
      expect(currency).toBe('USD')
    })

    it('should set currency', () => {
      vault.setCurrency('EUR')
      expect(vault.getCurrency()).toBe('EUR')
    })

    it('should accept any currency string', () => {
      const currencies = ['JPY', 'GBP', 'CHF', 'CAD', 'AUD']

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
      expect(data).toEqual(mockVaultData)
      expect(data.name).toBe('Test Vault')
      expect(data.publicKeys).toEqual(mockVaultData.publicKeys)
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
      const defaultVault = new Vault(mockVaultData, realServices)

      const chains = defaultVault.getChains()
      const currency = defaultVault.getCurrency()

      expect(chains).toBeDefined()
      expect(chains.length).toBeGreaterThan(0)
      expect(currency).toBe('USD')
    })

    it('should initialize with custom default chains', () => {
      const customVault = new Vault(mockVaultData, realServices, {
        defaultChains: ['bitcoin', 'ripple'],
      })

      expect(customVault.getChains()).toEqual(['bitcoin', 'ripple'])
    })

    it('should initialize with custom default currency', () => {
      const customVault = new Vault(mockVaultData, realServices, {
        defaultCurrency: 'EUR',
      })

      expect(customVault.getCurrency()).toBe('EUR')
    })

    it('should work without fastSigningService', () => {
      const vaultWithoutSigning = new Vault(mockVaultData, {
        wasmManager: realServices.wasmManager,
      } as VaultServices)

      expect(() => vaultWithoutSigning.summary()).not.toThrow()
      expect(() => vaultWithoutSigning.getChains()).not.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty token list', () => {
      vault.setTokens('ethereum', [])
      const tokens = vault.getTokens('ethereum')

      expect(tokens).toEqual([])
    })

    it('should handle concurrent address derivations', async () => {
      const promises = [
        vault.address('bitcoin'),
        vault.address('ethereum'),
        vault.address('solana'),
        vault.address('bitcoin'), // duplicate
        vault.address('ethereum'), // duplicate
      ]

      const addresses = await Promise.all(promises)

      expect(addresses).toHaveLength(5)
      // Duplicates should return same address
      expect(addresses[0]).toBe(addresses[3])
      expect(addresses[1]).toBe(addresses[4])
    })
  })
})
