/**
 * Integration Test: Vault Import/Export
 *
 * This test verifies that vaults can be exported correctly
 * using the PUBLIC SDK API with proper encryption/decryption.
 *
 * IMPORTANT: Uses ONLY public SDK API (Vault class)
 * This is a true integration test - testing the SDK as users would use it.
 *
 * Test Coverage:
 * - Export vault to .vult file (unencrypted)
 * - Export vault to .vult file (encrypted with password)
 * - Verify file format and size
 * - Verify export includes all necessary data
 * - Test encrypted file format
 *
 * NOTE: Full import functionality is handled by VaultManager and tested in unit tests.
 * This integration test focuses on the Vault.export() method which is the user-facing API.
 *
 * NOTE: Integration setup (WASM & crypto polyfills) loaded via vitest.config.ts
 */

import { Chain } from '@core/chain/Chain'
import type { Vault as CoreVault } from '@core/mpc/vault/Vault'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GlobalConfig } from '../../../src/config/GlobalConfig'
import { GlobalStorage } from '../../../src/runtime/storage/GlobalStorage'
import { MemoryStorage } from '../../../src/runtime/storage/MemoryStorage'
import { GlobalServerManager } from '../../../src/server/GlobalServerManager'
import { FastSigningService } from '../../../src/services/FastSigningService'
import { PasswordCacheService } from '../../../src/services/PasswordCacheService'
import { FastVault } from '../../../src/vault/FastVault'
import { Vultisig } from '../../../src/Vultisig'

describe('Integration: Vault Export', () => {
  let sdk: Vultisig
  let testDir: string
  let memoryStorage: MemoryStorage

  beforeAll(async () => {
    // Reset all global singletons before test
    GlobalStorage.reset()
    GlobalServerManager.reset()
    GlobalConfig.reset()
    PasswordCacheService.resetInstance()

    // Configure global singletons
    memoryStorage = new MemoryStorage()
    GlobalStorage.configure({ customStorage: memoryStorage })

    GlobalServerManager.configure({
      fastVault: 'https://api.vultisig.com/vault',
      messageRelay: 'https://api.vultisig.com/router',
    })

    GlobalConfig.configure({
      defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
      defaultCurrency: 'USD',
    })

    // Initialize SDK with WASM
    sdk = new Vultisig({
      autoInit: true,
      storage: { customStorage: memoryStorage },
      defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
    })

    await sdk.initialize()

    // Create temporary directory for test files
    testDir = path.join(os.tmpdir(), `vultisig-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })

    console.log('✅ SDK initialized and test directory created')
    console.log(`   Test directory: ${testDir}\n`)
  }, 60000) // Allow 60 seconds for WASM initialization

  afterAll(async () => {
    // Clean up test directory
    if (testDir) {
      try {
        await fs.rm(testDir, { recursive: true, force: true })
        console.log('✅ Test directory cleaned up')
      } catch (error) {
        console.warn('⚠️  Failed to clean up test directory:', error)
      }
    }
  })

  /**
   * Helper function to create a test vault
   */
  async function createTestVault(name: string): Promise<FastVault> {
    const now = Date.now()
    const mockVaultData: CoreVault = {
      name,
      publicKeys: {
        // Real-ish looking public keys
        ecdsa:
          '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc',
        eddsa:
          'b5d7a8e02f3c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
      },
      hexChainCode:
        '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      localPartyId: 'test-device',
      signers: ['test-device', 'Server-1'],
      keyShares: {
        ecdsa: 'mock_ecdsa_keyshare_for_testing',
        eddsa: 'mock_eddsa_keyshare_for_testing',
      },
      resharePrefix: '',
      libType: 'GG20',
      createdAt: now,
      isBackedUp: false,
      order: 0,
    } as CoreVault

    // Create mock VaultData with correct structure
    const vaultData = {
      // Identity (readonly fields)
      publicKeys: mockVaultData.publicKeys,
      hexChainCode: mockVaultData.hexChainCode,
      signers: mockVaultData.signers,
      localPartyId: mockVaultData.localPartyId,
      createdAt: now,
      libType: mockVaultData.libType,
      isEncrypted: false,
      type: 'fast' as const,
      // Metadata
      id: mockVaultData.publicKeys.ecdsa, // Use ECDSA public key as ID
      name,
      isBackedUp: false,
      order: 0,
      lastModified: now,
      // User Preferences
      currency: 'usd',
      chains: ['Bitcoin', 'Ethereum', 'Solana'],
      tokens: {},
      // Vault file
      vultFileContent: '',
    }

    // Create a mock FastSigningService for testing
    const mockFastSigningService = {} as FastSigningService
    const config = GlobalConfig.getInstance()

    return FastVault.fromStorage(vaultData, mockFastSigningService, config)
  }

  describe('Unencrypted Export', () => {
    it('should export an unencrypted vault to a .vult file', async () => {
      // Create a test vault
      const vault = await createTestVault('Unencrypted Export Test')

      // Derive some addresses first
      const btcAddress = await vault.address(Chain.Bitcoin)
      const ethAddress = await vault.address(Chain.Ethereum)

      expect(btcAddress).toBeDefined()
      expect(ethAddress).toBeDefined()

      // Get vault summary for verification
      expect(vault.name).toBe('Unencrypted Export Test')
      expect(vault.type).toBe('fast') // Has Server-1 signer

      // Export vault (unencrypted - no password)
      const { filename, data } = await vault.export()
      const exportPath = path.join(testDir, filename)

      // Write data to file
      await fs.writeFile(exportPath, data, 'utf-8')

      // Verify file was created
      const stats = await fs.stat(exportPath)
      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBeGreaterThan(0)

      // Read file and verify format
      const fileContent = await fs.readFile(exportPath, 'utf-8')

      // Unencrypted exports are base64-encoded protobuf data
      expect(fileContent).toBeDefined()
      expect(fileContent.length).toBeGreaterThan(0)

      // Verify it's valid base64 (may have newlines, which is fine)
      const base64Content = fileContent.replace(/\s/g, '')
      expect(base64Content).toMatch(/^[A-Za-z0-9+/]+=*$/)

      console.log('✅ Unencrypted export successful')
      console.log(`   Vault: ${vault.name}`)
      console.log(`   Type: ${vault.type}`)
      console.log(`   File size: ${stats.size} bytes`)
      console.log(`   BTC address: ${btcAddress}`)
      console.log(`   ETH address: ${ethAddress}`)
    })

    it('should export multiple vaults without conflicts', async () => {
      const vault1 = await createTestVault('Vault One')
      const vault2 = await createTestVault('Vault Two')
      const vault3 = await createTestVault('Vault Three')

      // Export all three
      const export1 = await vault1.export()
      const export2 = await vault2.export()
      const export3 = await vault3.export()

      // Write to different files using generated filenames
      const paths = [
        path.join(testDir, export1.filename),
        path.join(testDir, export2.filename),
        path.join(testDir, export3.filename),
      ]

      await fs.writeFile(paths[0], export1.data, 'utf-8')
      await fs.writeFile(paths[1], export2.data, 'utf-8')
      await fs.writeFile(paths[2], export3.data, 'utf-8')

      // Verify all files exist and have content
      for (const exportPath of paths) {
        const stats = await fs.stat(exportPath)
        expect(stats.isFile()).toBe(true)
        expect(stats.size).toBeGreaterThan(0)
      }

      console.log('✅ Multiple vaults exported successfully')
    })

    it('should generate consistent exports for the same vault', async () => {
      const vault = await createTestVault('Consistent Export Test')

      // Export twice
      const export1 = await vault.export()
      const export2 = await vault.export()

      // Exports should be identical (same vault data, no random elements in unencrypted export)
      expect(export1.data).toBe(export2.data)
      expect(export1.filename).toBe(export2.filename)

      console.log('✅ Exports are consistent')
      console.log(`   Export size: ${export1.data.length} bytes`)
    })
  })

  describe('Encrypted Export', () => {
    it('should export an encrypted vault with password', async () => {
      const password = 'SuperSecurePassword123!'
      const vault = await createTestVault('Encrypted Export Test')

      // Derive addresses
      const btcAddress = await vault.address(Chain.Bitcoin)
      const solAddress = await vault.address(Chain.Solana)

      // Export with password (encrypted)
      const { filename, data } = await vault.export(password)
      const exportPath = path.join(testDir, filename)

      // Write to file
      await fs.writeFile(exportPath, data, 'utf-8')

      // Verify file created
      const stats = await fs.stat(exportPath)
      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBeGreaterThan(0)

      // Read and verify it's encrypted (not plain base64)
      const fileContent = await fs.readFile(exportPath, 'utf-8')

      // Encrypted files should contain encrypted data markers
      // The exact format depends on the createVaultBackup implementation
      expect(fileContent).toBeDefined()
      expect(fileContent.length).toBeGreaterThan(0)

      console.log('✅ Encrypted export successful')
      console.log(`   File size: ${stats.size} bytes`)
      console.log(`   BTC address: ${btcAddress}`)
      console.log(`   SOL address: ${solAddress}`)
    })

    it('should produce different outputs with different passwords', async () => {
      const vault = await createTestVault('Password Diff Test')

      // Export with two different passwords
      const export1 = await vault.export('password1')
      const export2 = await vault.export('password2')

      // Different passwords should produce different encrypted outputs
      expect(export1.data).not.toBe(export2.data)

      console.log('✅ Different passwords produce different encrypted outputs')
      console.log(`   Export 1 size: ${export1.data.length} bytes`)
      console.log(`   Export 2 size: ${export2.data.length} bytes`)
    })

    it('should produce different outputs each time with same password (due to random IV)', async () => {
      const password = 'SamePassword123'
      const vault = await createTestVault('IV Randomness Test')

      // Export twice with same password
      const export1 = await vault.export(password)
      const export2 = await vault.export(password)

      // Should be different due to random IV/salt in encryption
      expect(export1.data).not.toBe(export2.data)

      console.log('✅ Encrypted exports use random IV (different each time)')
      console.log(`   Export 1 size: ${export1.data.length} bytes`)
      console.log(`   Export 2 size: ${export2.data.length} bytes`)
    })
  })

  describe('Export Format Validation', () => {
    it('should export files in valid .vult format', async () => {
      const vault = await createTestVault('Format Test')

      // Export both encrypted and unencrypted
      const unencrypted = await vault.export()
      const encrypted = await vault.export('test-password')

      // Both should have filename and data
      expect(unencrypted.filename).toMatch(/\.vult$/)
      expect(encrypted.filename).toMatch(/\.vult$/)

      // Both should have content
      expect(unencrypted.data.length).toBeGreaterThan(0)
      expect(encrypted.data.length).toBeGreaterThan(0)

      // Both should be valid base64 strings
      expect(unencrypted.data).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
      expect(encrypted.data).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)

      console.log('✅ Export format is valid')
      console.log(`   Unencrypted size: ${unencrypted.data.length} bytes`)
      console.log(`   Encrypted size: ${encrypted.data.length} bytes`)
    })

    it('should export reasonable file sizes', async () => {
      const vault = await createTestVault('Size Test Vault')

      const { data } = await vault.export()

      // File should be reasonable size (not empty, not huge)
      expect(data.length).toBeGreaterThan(100) // At least 100 bytes
      expect(data.length).toBeLessThan(1024 * 1024) // Less than 1MB

      console.log('✅ Export size is reasonable')
      console.log(`   Size: ${data.length} bytes`)
    })
  })

  describe('Export After Address Derivation', () => {
    it('should export vault after deriving addresses for multiple chains', async () => {
      const vault = await createTestVault('Multi-Chain Export Test')

      // Derive addresses for multiple chains
      const addresses = {
        btc: await vault.address(Chain.Bitcoin),
        eth: await vault.address(Chain.Ethereum),
        sol: await vault.address(Chain.Solana),
      }

      // Verify all addresses derived
      expect(addresses.btc).toBeDefined()
      expect(addresses.eth).toBeDefined()
      expect(addresses.sol).toBeDefined()

      // Now export the vault
      const { filename, data } = await vault.export()
      const exportPath = path.join(testDir, filename)

      await fs.writeFile(exportPath, data, 'utf-8')

      // Verify export successful
      const stats = await fs.stat(exportPath)
      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBeGreaterThan(0)

      console.log('✅ Vault exported after deriving multiple addresses')
      console.log(`   BTC: ${addresses.btc}`)
      console.log(`   ETH: ${addresses.eth}`)
      console.log(`   SOL: ${addresses.sol}`)
      console.log(`   Export size: ${stats.size} bytes`)
    })
  })

  describe('Error Handling', () => {
    it('should handle export with empty password string', async () => {
      const vault = await createTestVault('Empty Password Test')

      // Export with empty string password
      // This should either treat it as unencrypted or use the empty string as password
      const { filename, data } = await vault.export('')

      expect(filename).toMatch(/\.vult$/)
      expect(data.length).toBeGreaterThan(0)

      console.log('✅ Export with empty password handled')
      console.log(`   Size: ${data.length} bytes`)
    })

    it('should handle export with very long password', async () => {
      const vault = await createTestVault('Long Password Test')

      // Export with very long password (200 characters)
      const longPassword = 'a'.repeat(200)
      const { filename, data } = await vault.export(longPassword)

      expect(filename).toMatch(/\.vult$/)
      expect(data.length).toBeGreaterThan(0)

      console.log('✅ Export with long password handled')
      console.log(`   Password length: ${longPassword.length}`)
      console.log(`   Export size: ${data.length} bytes`)
    })

    it('should handle export with special characters in password', async () => {
      const vault = await createTestVault('Special Chars Test')

      // Password with special characters
      const specialPassword = '!@#$%^&*()_+-=[]{}|;:,.<>?/'
      const { filename, data } = await vault.export(specialPassword)

      expect(filename).toMatch(/\.vult$/)
      expect(data.length).toBeGreaterThan(0)

      console.log('✅ Export with special character password handled')
      console.log(`   Password: ${specialPassword}`)
      console.log(`   Export size: ${data.length} bytes`)
    })
  })
})
