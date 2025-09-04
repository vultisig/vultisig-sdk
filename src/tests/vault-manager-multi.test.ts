/**
 * VaultManager Multi-Vault Tests
 * Tests VaultManager's ability to handle multiple vaults with the new static architecture
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { VaultManager } from '../vault/VaultManager'
import { Vault as VaultClass } from '../vault/Vault'
import { VaultImportError } from '../vault/VaultError'

import type { Vault } from '../types'

describe('VaultManager Multi-Vault Tests', () => {
  const testVaultsDir = join(__dirname, 'vaults')

  beforeEach(async () => {
    // Clear all vaults and address book before each test
    await VaultManager.clear()
    
    // Initialize VaultManager with mock SDK
    const mockSDK = {
      wasmManager: {
        getWalletCore: () => null
      }
    }
    VaultManager.init(mockSDK)
  })

  afterEach(async () => {
    // Clean up after each test
    await VaultManager.clear()
  })

  describe('Multi-Vault Management', () => {
    test('should add multiple vaults and list them', async () => {
      // Load both test vaults
      const fastVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const secureVaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      const fastVaultBuffer = readFileSync(fastVaultPath)
      const secureVaultBuffer = readFileSync(secureVaultPath)

      const fastVaultFile = new File([fastVaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      const secureVaultFile = new File([secureVaultBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      // For Node.js testing, attach the buffers directly
      ;(fastVaultFile as any).buffer = fastVaultBuffer
      ;(secureVaultFile as any).buffer = secureVaultBuffer

      // Add both vaults
      const fastVault = await VaultManager.add(fastVaultFile, 'Password123!')
      const secureVault = await VaultManager.add(secureVaultFile)

      // Verify both vaults are VaultClass instances
      expect(fastVault).toBeInstanceOf(VaultClass)
      expect(secureVault).toBeInstanceOf(VaultClass)

      // List all vaults
      const vaultList = await VaultManager.list()
      
      // Should have 2 vaults
      expect(vaultList).toHaveLength(2)
      
      // Verify vault summaries
      const fastSummary = vaultList.find(v => v.name.includes('TestFastVault'))
      const secureSummary = vaultList.find(v => v.name.includes('TestSecureVault'))
      
      expect(fastSummary).toBeDefined()
      expect(secureSummary).toBeDefined()
      
      expect(fastSummary!.type).toBe('fast')
      expect(secureSummary!.type).toBe('fast') // 2 signers = fast type
      
      expect(fastSummary!.totalSigners).toBe(2)
      expect(secureSummary!.totalSigners).toBe(2)
    })

    test('should manage active vault correctly', async () => {
      // Initially no active vault
      expect(VaultManager.hasActive()).toBe(false)
      expect(VaultManager.getActive()).toBe(null)

      // Load a vault
      const vaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vaultBuffer = readFileSync(vaultPath)
      const vaultFile = new File([vaultBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      ;(vaultFile as any).buffer = vaultBuffer

      const vault = await VaultManager.add(vaultFile)
      
      // Set as active
      VaultManager.setActive(vault)
      
      expect(VaultManager.hasActive()).toBe(true)
      expect(VaultManager.getActive()).toBe(vault)
      
      // Load another vault and make it active
      const fastVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const fastVaultBuffer = readFileSync(fastVaultPath)
      const fastVaultFile = new File([fastVaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      ;(fastVaultFile as any).buffer = fastVaultBuffer

      const fastVault = await VaultManager.add(fastVaultFile, 'Password123!')
      
      // Use load() which should make it active
      await VaultManager.load(fastVault)
      
      expect(VaultManager.getActive()).toBe(fastVault)
      expect(VaultManager.getActive()).not.toBe(vault)
    })

    test('should remove vaults correctly', async () => {
      // Add two vaults
      const fastVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const secureVaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      const fastVaultBuffer = readFileSync(fastVaultPath)
      const secureVaultBuffer = readFileSync(secureVaultPath)

      const fastVaultFile = new File([fastVaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      const secureVaultFile = new File([secureVaultBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      ;(fastVaultFile as any).buffer = fastVaultBuffer
      ;(secureVaultFile as any).buffer = secureVaultBuffer

      const fastVault = await VaultManager.add(fastVaultFile, 'Password123!')
      const secureVault = await VaultManager.add(secureVaultFile)

      // Set fast vault as active
      VaultManager.setActive(fastVault)
      
      // Verify we have 2 vaults
      expect((await VaultManager.list())).toHaveLength(2)
      expect(VaultManager.getActive()).toBe(fastVault)

      // Remove the active vault
      await VaultManager.remove(fastVault)
      
      // Should have 1 vault left and no active vault
      expect((await VaultManager.list())).toHaveLength(1)
      expect(VaultManager.getActive()).toBe(null)
      
      // Remove the remaining vault
      await VaultManager.remove(secureVault)
      
      // Should have no vaults
      expect((await VaultManager.list())).toHaveLength(0)
    })

    test('should clear all vaults', async () => {
      // Add multiple vaults
      const fastVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const secureVaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      const fastVaultBuffer = readFileSync(fastVaultPath)
      const secureVaultBuffer = readFileSync(secureVaultPath)

      const fastVaultFile = new File([fastVaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      const secureVaultFile = new File([secureVaultBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      ;(fastVaultFile as any).buffer = fastVaultBuffer
      ;(secureVaultFile as any).buffer = secureVaultBuffer

      const fastVault = await VaultManager.add(fastVaultFile, 'Password123!')
      const secureVault = await VaultManager.add(secureVaultFile)
      
      VaultManager.setActive(fastVault)

      // Verify we have vaults and an active vault
      expect((await VaultManager.list())).toHaveLength(2)
      expect(VaultManager.hasActive()).toBe(true)

      // Clear all vaults
      await VaultManager.clear()

      // Should have no vaults and no active vault
      expect((await VaultManager.list())).toHaveLength(0)
      expect(VaultManager.hasActive()).toBe(false)
      expect(VaultManager.getActive()).toBe(null)
    })
  })

  describe('Global Configuration', () => {
    test('should manage default chains', async () => {
      // Test default chains
      const defaultChains = VaultManager.getDefaultChains()
      expect(defaultChains).toEqual(['bitcoin', 'ethereum'])

      // Set new default chains
      const newChains = ['bitcoin', 'ethereum', 'solana', 'polygon']
      await VaultManager.setDefaultChains(newChains)

      expect(VaultManager.getDefaultChains()).toEqual(newChains)
    })

    test('should manage default currency', async () => {
      // Test default currency
      expect(VaultManager.getDefaultCurrency()).toBe('USD')

      // Set new default currency
      await VaultManager.setDefaultCurrency('EUR')
      expect(VaultManager.getDefaultCurrency()).toBe('EUR')
    })

    test('should save and get configuration', async () => {
      const newConfig = {
        defaultChains: ['bitcoin', 'ethereum', 'solana'],
        defaultCurrency: 'GBP'
      }

      await VaultManager.saveConfig(newConfig)
      
      const savedConfig = VaultManager.getConfig()
      expect(savedConfig.defaultChains).toEqual(newConfig.defaultChains)
      expect(savedConfig.defaultCurrency).toBe(newConfig.defaultCurrency)
    })
  })

  describe('Address Book Management', () => {
    test('should manage address book entries', async () => {
      // Initially empty
      const initialAddressBook = await VaultManager.addressBook()
      expect(initialAddressBook.saved).toHaveLength(0)
      expect(initialAddressBook.vaults).toHaveLength(0)

      // Add some entries
      const entries = [
        {
          chain: 'bitcoin',
          address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          name: 'My BTC Address',
          source: 'saved' as const
        },
        {
          chain: 'ethereum',
          address: '0x742d35Cc6634C0532925a3b8D400d0b5d3d6Fd8b',
          name: 'My ETH Address',
          source: 'saved' as const
        }
      ]

      await VaultManager.addAddressBookEntry(entries)

      // Verify entries were added
      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(2)
      
      const btcEntry = addressBook.saved.find(e => e.chain === 'bitcoin')
      const ethEntry = addressBook.saved.find(e => e.chain === 'ethereum')
      
      expect(btcEntry).toBeDefined()
      expect(ethEntry).toBeDefined()
      expect(btcEntry!.name).toBe('My BTC Address')
      expect(ethEntry!.name).toBe('My ETH Address')
    })

    test('should filter address book by chain', async () => {
      // Add entries for multiple chains
      const entries = [
        {
          chain: 'bitcoin',
          address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          name: 'BTC Address 1',
          source: 'saved' as const
        },
        {
          chain: 'ethereum',
          address: '0x742d35Cc6634C0532925a3b8D400d0b5d3d6Fd8b',
          name: 'ETH Address 1',
          source: 'saved' as const
        }
      ]

      await VaultManager.addAddressBookEntry(entries)

      // Filter by chain
      const btcAddressBook = await VaultManager.addressBook('bitcoin')
      const ethAddressBook = await VaultManager.addressBook('ethereum')

      expect(btcAddressBook.saved).toHaveLength(1)
      expect(ethAddressBook.saved).toHaveLength(1)
      
      expect(btcAddressBook.saved[0].chain).toBe('bitcoin')
      expect(ethAddressBook.saved[0].chain).toBe('ethereum')
    })

    test('should remove address book entries', async () => {
      // Add entries
      const entries = [
        {
          chain: 'bitcoin',
          address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          name: 'BTC Address',
          source: 'saved' as const
        },
        {
          chain: 'ethereum',
          address: '0x742d35Cc6634C0532925a3b8D400d0b5d3d6Fd8b',
          name: 'ETH Address',
          source: 'saved' as const
        }
      ]

      await VaultManager.addAddressBookEntry(entries)
      expect((await VaultManager.addressBook()).saved).toHaveLength(2)

      // Remove one entry
      await VaultManager.removeAddressBookEntry([
        { chain: 'bitcoin', address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' }
      ])

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(1)
      expect(addressBook.saved[0].chain).toBe('ethereum')
    })

    test('should update address book entry names', async () => {
      // Add entry
      const entries = [
        {
          chain: 'bitcoin',
          address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          name: 'Original Name',
          source: 'saved' as const
        }
      ]

      await VaultManager.addAddressBookEntry(entries)

      // Update name
      await VaultManager.updateAddressBookEntry(
        'bitcoin',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        'Updated Name'
      )

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved[0].name).toBe('Updated Name')
    })
  })

  describe('Vault Details and Validation', () => {
    test('should get vault details using static method', async () => {
      const vaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultBuffer = readFileSync(vaultPath)
      const vaultFile = new File([vaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      ;(vaultFile as any).buffer = vaultBuffer

      const vaultInstance = await VaultManager.add(vaultFile, 'Password123!')
      const vaultData = vaultInstance.data

      // Get vault details using static method
      const details = VaultManager.getVaultDetails(vaultData)

      expect(details).toBeDefined()
      expect(details.name).toBe(vaultData.name)
      expect(details.id).toBe(vaultData.publicKeys.ecdsa)
      expect(details.securityType).toBe('fast')
      expect(details.threshold).toBe(2)
      expect(details.participants).toBe(2)
      expect(details.isBackedUp).toBe(true)
    })

    test('should validate vault using static method', async () => {
      const vaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vaultBuffer = readFileSync(vaultPath)
      const vaultFile = new File([vaultBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      ;(vaultFile as any).buffer = vaultBuffer

      const vaultInstance = await VaultManager.add(vaultFile)
      const vaultData = vaultInstance.data

      // Validate using static method
      const validation = VaultManager.validateVault(vaultData)

      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)
    })
  })

  describe('Error Handling', () => {
    test('should handle invalid vault files', async () => {
      const invalidData = Buffer.from('invalid vault data')
      const invalidFile = new File([invalidData], 'invalid.vult')

      await expect(VaultManager.add(invalidFile)).rejects.toThrow(VaultImportError)
    })

    test('should handle non-.vult files', async () => {
      const invalidData = Buffer.from('some data')
      const invalidFile = new File([invalidData], 'invalid.txt')

      await expect(VaultManager.add(invalidFile)).rejects.toThrow(VaultImportError)
    })
  })

  describe('Encryption Detection', () => {
    test('should detect encrypted and unencrypted vaults', async () => {
      const encryptedVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const unencryptedVaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      const encryptedBuffer = readFileSync(encryptedVaultPath)
      const unencryptedBuffer = readFileSync(unencryptedVaultPath)

      const encryptedFile = new File([encryptedBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      const unencryptedFile = new File([unencryptedBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      ;(encryptedFile as any).buffer = encryptedBuffer
      ;(unencryptedFile as any).buffer = unencryptedBuffer

      const encryptedStatus = await VaultManager.isEncrypted(encryptedFile)
      const unencryptedStatus = await VaultManager.isEncrypted(unencryptedFile)

      expect(encryptedStatus).toBe(true)
      expect(unencryptedStatus).toBe(false)
    })
  })
})
