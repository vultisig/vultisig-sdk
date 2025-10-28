/**
 * Vault Rename Tests
 * Tests vault renaming functionality including validation and storage updates
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { Vultisig } from '../../src/index'
import { VaultError, VaultErrorCode } from '../vault/VaultError'

describe('Vault Rename Tests', () => {
  let vultisig: Vultisig

  beforeEach(async () => {
    vultisig = new Vultisig()
    await vultisig.clearVaults()
  })

  afterEach(async () => {
    await vultisig.clearVaults()
  })

  describe('Basic Rename Operations', () => {
    test('should successfully rename vault with valid name', async () => {
      // Import test vault
      const vaultName = join(
        __dirname,
        'vaults',
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer
      const vault = await vultisig.addVault(vaultFile, 'Password123!')

      // Verify initial name
      expect(vault.summary().name).toBe('TestFastVault')

      // Rename vault
      const newName = 'My New Vault Name'
      await vault.rename(newName)

      // Verify name has changed
      expect(vault.summary().name).toBe(newName)
      expect(vault.data.name).toBe(newName)
    })

    test('should update vault in storage after rename', async () => {
      // Import test vault
      const vaultName = join(
        __dirname,
        'vaults',
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer
      const vault = await vultisig.addVault(vaultFile, 'Password123!')

      // Rename vault
      const newName = 'Updated Vault Name'
      await vault.rename(newName)

      // Verify vault list reflects the change
      const vaultList = await vultisig.listVaults()
      const renamedVault = vaultList.find(
        v => v.id === vault.data.publicKeys.ecdsa
      )
      expect(renamedVault?.name).toBe(newName)
    })

    test('should preserve all other vault properties after rename', async () => {
      // Import test vault
      const vaultName = join(
        __dirname,
        'vaults',
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer
      const vault = await vultisig.addVault(vaultFile, 'Password123!')

      // Capture original properties
      const originalSummary = vault.summary()
      const originalPublicKeys = vault.data.publicKeys
      const originalSigners = vault.data.signers
      const originalThreshold = vault.data.threshold

      // Rename vault
      await vault.rename('New Name')

      // Verify all properties except name are preserved
      const newSummary = vault.summary()
      expect(newSummary.name).toBe('New Name')
      expect(newSummary.type).toBe(originalSummary.type)
      expect(newSummary.chains).toEqual(originalSummary.chains)
      expect(vault.data.publicKeys).toEqual(originalPublicKeys)
      expect(vault.data.signers).toEqual(originalSigners)
      expect(vault.data.threshold).toBe(originalThreshold)
    })
  })

  describe('Name Validation', () => {
    let vault: any

    beforeEach(async () => {
      // Import test vault for validation tests
      const vaultName = join(
        __dirname,
        'vaults',
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer
      vault = await vultisig.addVault(vaultFile, 'Password123!')
    })

    test('should reject empty name', async () => {
      await expect(vault.rename('')).rejects.toThrow(VaultError)
      await expect(vault.rename('   ')).rejects.toThrow(VaultError)
    })

    test('should reject name that is too short', async () => {
      await expect(vault.rename('A')).rejects.toThrow(VaultError)
    })

    test('should reject name that is too long', async () => {
      const longName = 'A'.repeat(51) // 51 characters, exceeds limit of 50
      await expect(vault.rename(longName)).rejects.toThrow(VaultError)
    })

    test('should reject name with invalid characters', async () => {
      await expect(vault.rename('Invalid@Name')).rejects.toThrow(VaultError)
      await expect(vault.rename('Name with $ symbols')).rejects.toThrow(
        VaultError
      )
      await expect(vault.rename('Name with % percent')).rejects.toThrow(
        VaultError
      )
    })

    test('should accept valid names with allowed characters', async () => {
      const validNames = [
        'Valid Name',
        'Valid-Name',
        'Valid_Name',
        'ValidName123',
        'My Vault 2024',
        'Test-Vault_001',
      ]

      for (const validName of validNames) {
        await expect(vault.rename(validName)).resolves.not.toThrow()
        expect(vault.summary().name).toBe(validName)
      }
    })

    test('should accept name exactly at length limits', async () => {
      // Test minimum length (2 characters)
      await expect(vault.rename('AB')).resolves.not.toThrow()
      expect(vault.summary().name).toBe('AB')

      // Test maximum length (50 characters)
      const maxLengthName = 'A'.repeat(50)
      await expect(vault.rename(maxLengthName)).resolves.not.toThrow()
      expect(vault.summary().name).toBe(maxLengthName)
    })
  })

  describe('Error Handling', () => {
    test('should throw VaultError with InvalidConfig code for validation errors', async () => {
      // Import test vault
      const vaultName = join(
        __dirname,
        'vaults',
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer
      const vault = await vultisig.addVault(vaultFile, 'Password123!')

      try {
        await vault.rename('')
        fail('Expected VaultError to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(VaultErrorCode.InvalidConfig)
        expect((error as VaultError).message).toContain(
          'Vault name cannot be empty'
        )
      }
    })

    test('should provide specific error messages for different validation failures', async () => {
      // Import test vault
      const vaultName = join(
        __dirname,
        'vaults',
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer
      const vault = await vultisig.addVault(vaultFile, 'Password123!')

      // Test empty name error
      try {
        await vault.rename('')
        fail('Expected error for empty name')
      } catch (error) {
        expect((error as VaultError).message).toContain(
          'Vault name cannot be empty'
        )
      }

      // Test too long name error
      try {
        await vault.rename('A'.repeat(51))
        fail('Expected error for long name')
      } catch (error) {
        expect((error as VaultError).message).toContain(
          'Vault name cannot exceed 50 characters'
        )
      }

      // Test invalid characters error
      try {
        await vault.rename('Invalid@Name')
        fail('Expected error for invalid characters')
      } catch (error) {
        expect((error as VaultError).message).toContain(
          'Vault name can only contain letters, numbers, spaces, hyphens, and underscores'
        )
      }
    })
  })

  describe('Multiple Vaults', () => {
    test('should rename specific vault without affecting others', async () => {
      // Import first vault
      const vault1Path = join(
        __dirname,
        'vaults',
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const vault1Buffer = readFileSync(vault1Path)
      const vault1File = new File([vault1Buffer], 'TestFastVault.vult')
      ;(vault1File as any).buffer = vault1Buffer
      const vault1 = await vultisig.addVault(vault1File, 'Password123!')

      // Import second vault
      const vault2Path = join(
        __dirname,
        'vaults',
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const vault2Buffer = readFileSync(vault2Path)
      const vault2File = new File([vault2Buffer], 'TestSecureVault.vult')
      ;(vault2File as any).buffer = vault2Buffer
      const vault2 = await vultisig.addVault(vault2File)

      // Rename first vault
      await vault1.rename('Renamed Fast Vault')

      // Verify first vault was renamed
      expect(vault1.summary().name).toBe('Renamed Fast Vault')

      // Verify second vault was not affected
      expect(vault2.summary().name).toBe('TestSecureVault')

      // Verify vault list reflects correct names
      const vaultList = await vultisig.listVaults()
      expect(vaultList).toHaveLength(2)

      const renamedVault = vaultList.find(
        v => v.id === vault1.data.publicKeys.ecdsa
      )
      const unchangedVault = vaultList.find(
        v => v.id === vault2.data.publicKeys.ecdsa
      )

      expect(renamedVault?.name).toBe('Renamed Fast Vault')
      expect(unchangedVault?.name).toBe('TestSecureVault')
    })
  })
})
