/**
 * Vault Import Tests
 * Tests VaultManager's ability to import .vult files and query vault summaries
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { VaultManager } from '../vault/VaultManager'
import { VaultImportError, VaultImportErrorCode } from '../vault/VaultError'

import type { Vault } from '../types'

type TestVaultData = {
  filename: string
  vault: {
    name: string
    localPartyId: string
    signers: string[]
    libType: string | number
    publicKeys: {
      ecdsa: string
      eddsa: string
    }
    hexChainCode: string
    createdAt: number
    isBackedUp: boolean
  }
  addresses: Record<string, string>
  decodedAt: string
}

describe('VaultManager Import Tests', () => {
  let vaultManager: VaultManager

  beforeEach(() => {
    vaultManager = new VaultManager()
  })

  describe('importVaultFromFile', () => {
    const testVaultsDir = join(__dirname, 'vaults')

    type VaultTestCase = {
      vaultFile: string
      expectedDataFile: string
      password?: string
      description: string
    }

    const testCases: VaultTestCase[] = [
      {
        vaultFile: 'TestFastVault-44fd-share2of2-Password123!.vult',
        expectedDataFile: 'vault-details-TestFastVault-44fd-share2of2-Password123!.json',
        password: 'Password123!',
        description: 'encrypted fast vault with password',
      },
      {
        vaultFile: 'TestSecureVault-cfa0-share2of2-NoPassword.vult',
        expectedDataFile: 'vault-details-TestSecureVault-cfa0-share2of2-Nopassword.json',
        description: 'unencrypted secure vault',
      },
    ]

    testCases.forEach(({ vaultFile, expectedDataFile, password, description }) => {
      test(`should import ${description}`, async () => {
        // Read the .vult file
        const vaultFilePath = join(testVaultsDir, vaultFile)
        const vaultFileBuffer = readFileSync(vaultFilePath)

        // Read the expected vault data
        const expectedDataPath = join(testVaultsDir, expectedDataFile)
        const expectedData: TestVaultData = JSON.parse(
          readFileSync(expectedDataPath, 'utf-8')
        )

        // Create File object from buffer
        const vaultFileObj = new File([vaultFileBuffer], vaultFile)
        // For Node.js testing, attach the buffer directly
        ;(vaultFileObj as any).buffer = vaultFileBuffer

        // Import the vault using static method
        const importedVault = await VaultManager.add(vaultFileObj, password)

        // Verify the imported vault matches expected structure
        expect(importedVault).toBeDefined()
        expect(importedVault.name).toBe(expectedData.vault.name)
        expect(importedVault.localPartyId).toBe(expectedData.vault.localPartyId)
        expect(importedVault.signers).toEqual(expectedData.vault.signers)
        expect(importedVault.publicKeys.ecdsa).toBe(expectedData.vault.publicKeys.ecdsa)
        expect(importedVault.publicKeys.eddsa).toBe(expectedData.vault.publicKeys.eddsa)
        expect(importedVault.hexChainCode).toBe(expectedData.vault.hexChainCode)
        expect(importedVault.createdAt).toBe(expectedData.vault.createdAt)
        expect(importedVault.isBackedUp).toBe(true) // Imported vaults are always backed up

        // Normalize libType comparison (handle string vs number)
        const expectedLibType = expectedData.vault.libType
        if (typeof expectedLibType === 'string') {
          expect(importedVault.libType).toBe(expectedLibType)
        } else {
          // Handle numeric libType (1 = DKLS in some formats)
          expect(importedVault.libType).toBe('DKLS')
        }
      })
    })

    test('should create Vault instance and get summary', async () => {
      const vaultFilePath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultFileBuffer = readFileSync(vaultFilePath)
      const expectedDataPath = join(testVaultsDir, 'vault-details-TestFastVault-44fd-share2of2-Password123!.json')
      const expectedData: TestVaultData = JSON.parse(
        readFileSync(expectedDataPath, 'utf-8')
      )

      // Create File object
      const vaultFileObj = new File([vaultFileBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      // For Node.js testing, attach the buffer directly
      ;(vaultFileObj as any).buffer = vaultFileBuffer

      // Import the vault using static method
      const importedVault = await VaultManager.add(vaultFileObj, 'Password123!')

      // Get vault details/summary using instance method
      const instance = new VaultManager()
      const vaultDetails = instance.getVaultDetails(importedVault)

      // Verify vault details
      expect(vaultDetails).toBeDefined()
      expect(vaultDetails.name).toBe(expectedData.vault.name)
      expect(vaultDetails.id).toBe(expectedData.vault.publicKeys.ecdsa)
      expect(vaultDetails.securityType).toBe('fast') // 2 signers = fast vault
      expect(vaultDetails.threshold).toBe(expectedData.vault.signers.length)
      expect(vaultDetails.participants).toBe(expectedData.vault.signers.length)
      expect(vaultDetails.createdAt).toBe(expectedData.vault.createdAt)
      expect(vaultDetails.isBackedUp).toBe(true) // Imported vaults are always backed up
      expect(vaultDetails.chains).toEqual([]) // Default empty chains until chain integration
    })

    test('should validate imported vault structure', async () => {
      const vaultFilePath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vaultFileBuffer = readFileSync(vaultFilePath)

      // Create File object
      const vaultFileObj = new File([vaultFileBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      // For Node.js testing, attach the buffer directly
      ;(vaultFileObj as any).buffer = vaultFileBuffer

      // Import the vault using static method
      const importedVault = await VaultManager.add(vaultFileObj)

      // Validate the vault using instance method
      const instance = new VaultManager()
      const validation = instance.validateVault(importedVault)

      // Should be valid with no errors
      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)

      // Imported vaults should be marked as backed up, so no warnings about backup status
      if (validation.warnings.length > 0) {
        expect(validation.warnings.some(w => w.includes('backed up'))).toBe(false)
      }
    })

    test('should handle encrypted vault without password', async () => {
      const vaultFilePath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultFileBuffer = readFileSync(vaultFilePath)

      // Create File object
      const vaultFileObj = new File([vaultFileBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      // For Node.js testing, attach the buffer directly
      ;(vaultFileObj as any).buffer = vaultFileBuffer

      // Try to import encrypted vault without password
      await expect(
        VaultManager.add(vaultFileObj)
      ).rejects.toThrow(VaultImportError)

      await expect(
        VaultManager.add(vaultFileObj)
      ).rejects.toThrow('Password is required to decrypt this vault')
    })

    test('should handle invalid password for encrypted vault', async () => {
      const vaultFilePath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultFileBuffer = readFileSync(vaultFilePath)

      // Create File object
      const vaultFileObj = new File([vaultFileBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      // For Node.js testing, attach the buffer directly
      ;(vaultFileObj as any).buffer = vaultFileBuffer

      // Try to import with wrong password
      await expect(
        VaultManager.add(vaultFileObj, 'WrongPassword')
      ).rejects.toThrow(VaultImportError)

      await expect(
        VaultManager.add(vaultFileObj, 'WrongPassword')
      ).rejects.toThrow('Invalid password for encrypted vault')
    })

    test('should detect vault encryption status', async () => {
      const encryptedVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const unencryptedVaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      // Create File objects for testing
      const encryptedBuffer = readFileSync(encryptedVaultPath)
      const unencryptedBuffer = readFileSync(unencryptedVaultPath)

      const encryptedFile = new File([encryptedBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      const unencryptedFile = new File([unencryptedBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      // For Node.js testing, attach the buffers directly
      ;(encryptedFile as any).buffer = encryptedBuffer
      ;(unencryptedFile as any).buffer = unencryptedBuffer

      // Test encryption detection using static method
      const encryptedStatus = await VaultManager.isEncrypted(encryptedFile)
      const unencryptedStatus = await VaultManager.isEncrypted(unencryptedFile)

      expect(encryptedStatus).toBe(true)
      expect(unencryptedStatus).toBe(false)
    })

    test('should handle File object input', async () => {
      const vaultFilePath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vaultBuffer = readFileSync(vaultFilePath)
      const expectedDataPath = join(testVaultsDir, 'vault-details-TestSecureVault-cfa0-share2of2-Nopassword.json')
      const expectedData: TestVaultData = JSON.parse(
        readFileSync(expectedDataPath, 'utf-8')
      )

      // Create File object
      const vaultFile = new File([vaultBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      // For Node.js testing, attach the buffer directly
      ;(vaultFile as any).buffer = vaultBuffer

      // Import using static method
      const importedVault = await VaultManager.add(vaultFile)

      // Verify import worked correctly
      expect(importedVault.name).toBe(expectedData.vault.name)
      expect(importedVault.publicKeys.ecdsa).toBe(expectedData.vault.publicKeys.ecdsa)
    })


    test('should fail with invalid vault data', async () => {
      // Test with invalid data
      const invalidData = Buffer.from('invalid vault data')
      const invalidFile = new File([invalidData], 'invalid.vult')

      await expect(
        VaultManager.add(invalidFile)
      ).rejects.toThrow(VaultImportError)
    })

    test('should handle different vault security types', async () => {
      // Test fast vault (2 signers)
      const fastVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const fastVaultBuffer = readFileSync(fastVaultPath)
      const fastVaultFile = new File([fastVaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      // For Node.js testing, attach the buffer directly
      ;(fastVaultFile as any).buffer = fastVaultBuffer

      const fastVault = await VaultManager.add(fastVaultFile, 'Password123!')
      const instance = new VaultManager()
      const fastDetails = instance.getVaultDetails(fastVault)

      expect(fastDetails.securityType).toBe('fast')
      expect(fastDetails.participants).toBe(2)

      // Test secure vault (2 signers but treated as secure in test data)
      const secureVaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const secureVaultBuffer = readFileSync(secureVaultPath)
      const secureVaultFile = new File([secureVaultBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      // For Node.js testing, attach the buffer directly
      ;(secureVaultFile as any).buffer = secureVaultBuffer

      const secureVault = await VaultManager.add(secureVaultFile)
      const secureDetails = instance.getVaultDetails(secureVault)

      expect(secureDetails.securityType).toBe('fast') // 2 signers = fast type
      expect(secureDetails.participants).toBe(2)
    })

    test('should store threshold on vault when loaded', async () => {
      // Test that threshold is calculated and stored when vault is loaded
      const vaultFilePath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vaultFileBuffer = readFileSync(vaultFilePath)
      const vaultFileObj = new File([vaultFileBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      ;(vaultFileObj as any).buffer = vaultFileBuffer

      // Import vault using VaultManager
      const loadedVault = await VaultManager.add(vaultFileObj)

      // Verify that threshold is stored on the vault object
      expect(loadedVault.threshold).toBeDefined()
      expect(typeof loadedVault.threshold).toBe('number')
      expect(loadedVault.threshold).toBe(2) // 2 signers -> threshold should be 2

      // Verify that getVaultDetails uses the stored threshold
      const instance = new VaultManager()
      const details = instance.getVaultDetails(loadedVault)
      expect(details.threshold).toBe(loadedVault.threshold)
    })
  })

  describe('error handling', () => {
    test('should provide detailed error information', async () => {
      const invalidData = Buffer.from('not a vault file')
      const invalidFile = new File([invalidData], 'invalid.vult')

      await expect(
        VaultManager.add(invalidFile)
      ).rejects.toThrow(VaultImportError)
    })

    test('should handle malformed .vult files', async () => {
      // Create a malformed .vult file (invalid base64)
      const malformedData = Buffer.from('this is not valid base64 data for a .vult file!')
      const malformedFile = new File([malformedData], 'malformed.vult')

      await expect(
        VaultManager.add(malformedFile)
      ).rejects.toThrow(VaultImportError)
    })
  })

  describe('threshold calculation', () => {
    test('should calculate correct threshold values', () => {
      // Test various participant counts and their expected thresholds
      const testCases = [
        { participants: 2, expectedThreshold: 2 }, // 2/3 of 2 = 1.33 -> 2 (minimum)
        { participants: 3, expectedThreshold: 2 }, // 2/3 of 3 = 2
        { participants: 4, expectedThreshold: 3 }, // 2/3 of 4 = 2.67 -> 3 (rounded up)
        { participants: 5, expectedThreshold: 4 }, // 2/3 of 5 = 3.33 -> 4 (rounded up)
        { participants: 6, expectedThreshold: 4 }, // 2/3 of 6 = 4
        { participants: 7, expectedThreshold: 5 }, // 2/3 of 7 = 4.67 -> 5 (rounded up)
        { participants: 9, expectedThreshold: 6 }, // 2/3 of 9 = 6
        { participants: 10, expectedThreshold: 7 }, // 2/3 of 10 = 6.67 -> 7 (rounded up)
      ]

      // Create a mock vault for each test case
      testCases.forEach(({ participants, expectedThreshold }) => {
        const mockVault: Vault = {
          name: `Test Vault ${participants}`,
          publicKeys: { ecdsa: 'test-key', eddsa: 'test-key' },
          signers: Array(participants).fill(null).map((_, i) => `signer-${i}`),
          createdAt: Date.now(),
          hexChainCode: 'test-chain-code',
          keyShares: { ecdsa: 'test-share', eddsa: 'test-share' },
          localPartyId: 'local-party',
          libType: 'DKLS',
          isBackedUp: true,
          order: 0,
        }

        const instance = new VaultManager()
        const details = instance.getVaultDetails(mockVault)
        
        expect(details.threshold).toBe(expectedThreshold)
        expect(details.participants).toBe(participants)
      })
    })

    test('should throw error for insufficient participants', () => {
      // Test that calculateThreshold throws for less than 2 participants
      const mockVault: Vault = {
        name: 'Invalid Vault',
        publicKeys: { ecdsa: 'test-key', eddsa: 'test-key' },
        signers: ['single-signer'], // Only 1 signer
        createdAt: Date.now(),
        hexChainCode: 'test-chain-code',
        keyShares: { ecdsa: 'test-share', eddsa: 'test-share' },
        localPartyId: 'local-party',
        libType: 'DKLS',
        isBackedUp: true,
        order: 0,
      }

      const instance = new VaultManager()
      expect(() => instance.getVaultDetails(mockVault)).toThrow('Vault must have at least 2 participants')
    })

  })
})
