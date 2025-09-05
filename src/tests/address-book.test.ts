import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { readFileSync } from 'fs'

import { VaultManager } from '../vault/VaultManager'
import type { AddressBookEntry } from '../types'

const testVaultsDir = join(__dirname, 'vaults')

describe('AddressBook Feature Tests', () => {
  beforeEach(async () => {
    // Clear any existing address book data
    await VaultManager.clear()

    // VaultManager is auto-initialized when SDK is initialized
    // For basic tests that don't need address derivation, we can init with null
    VaultManager.init(null)
  })

  afterEach(async () => {
    // Clean up after each test
    await VaultManager.clear()
  })

  describe('Basic AddressBook Operations', () => {
    test('should start with empty address book', async () => {
      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(0)
      expect(addressBook.vaults).toHaveLength(0)
    })

    test('should add single address book entry', async () => {
      const entry: AddressBookEntry = {
        chain: 'bitcoin',
        address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        name: 'TestFastVault BTC',
        source: 'saved'
      }

      await VaultManager.addAddressBookEntry([entry])

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(1)
      expect(addressBook.saved[0]).toMatchObject(entry)
      expect(addressBook.saved[0].dateAdded).toBeDefined()
    })

    test('should add multiple address book entries', async () => {
      const entries: AddressBookEntry[] = [
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'TestFastVault BTC',
          source: 'saved'
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'TestFastVault ETH',
          source: 'saved'
        },
        {
          chain: 'solana',
          address: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR',
          name: 'TestFastVault SOL',
          source: 'saved'
        }
      ]

      await VaultManager.addAddressBookEntry(entries)

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(3)

      // Verify all entries were added with proper metadata
      entries.forEach((entry, index) => {
        expect(addressBook.saved[index]).toMatchObject(entry)
        expect(addressBook.saved[index].dateAdded).toBeDefined()
      })
    })
  })

  describe('Vault Integration Tests', () => {
    test('should add vault addresses to address book', async () => {
      // Import TestFastVault
      const vaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultBuffer = readFileSync(vaultPath)
      const vaultFile = new File([vaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      ;(vaultFile as any).buffer = vaultBuffer

      const vault = await VaultManager.add(vaultFile, 'Password123!')

      // Create address book entries from vault addresses
      const vaultEntries: AddressBookEntry[] = [
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'TestFastVault BTC',
          source: 'vaults',
          vaultId: vault.data.publicKeys.ecdsa,
          vaultName: 'TestFastVault'
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'TestFastVault ETH',
          source: 'vaults',
          vaultId: vault.data.publicKeys.ecdsa,
          vaultName: 'TestFastVault'
        }
      ]

      await VaultManager.addAddressBookEntry(vaultEntries)

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.vaults).toHaveLength(2)

      // Verify vault-specific fields
      addressBook.vaults.forEach((entry, index) => {
        expect(entry.vaultId).toBe(vault.data.publicKeys.ecdsa)
        expect(entry.vaultName).toBe('TestFastVault')
        expect(entry.source).toBe('vaults')
      })
    })

    test('should handle multiple vaults in address book', async () => {
      // Import both vaults
      const fastVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const secureVaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-Nopassword.vult')

      const fastVaultBuffer = readFileSync(fastVaultPath)
      const secureVaultBuffer = readFileSync(secureVaultPath)

      const fastVaultFile = new File([fastVaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      const secureVaultFile = new File([secureVaultBuffer], 'TestSecureVault-cfa0-share2of2-Nopassword.vult')

      ;(fastVaultFile as any).buffer = fastVaultBuffer
      ;(secureVaultFile as any).buffer = secureVaultBuffer

      const fastVault = await VaultManager.add(fastVaultFile, 'Password123!')
      const secureVault = await VaultManager.add(secureVaultFile)

      // Add addresses from both vaults
      const vaultEntries: AddressBookEntry[] = [
        // Fast vault addresses
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'FastVault BTC',
          source: 'vaults',
          vaultId: fastVault.data.publicKeys.ecdsa,
          vaultName: 'TestFastVault'
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'FastVault ETH',
          source: 'vaults',
          vaultId: fastVault.data.publicKeys.ecdsa,
          vaultName: 'TestFastVault'
        },
        // Secure vault addresses
        {
          chain: 'bitcoin',
          address: 'bc1qg7gldwlccw9qeyzpew37hetu2ys042wnu2n3l4',
          name: 'SecureVault BTC',
          source: 'vaults',
          vaultId: secureVault.data.publicKeys.ecdsa,
          vaultName: 'TestSecureVault'
        },
        {
          chain: 'ethereum',
          address: '0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97',
          name: 'SecureVault ETH',
          source: 'vaults',
          vaultId: secureVault.data.publicKeys.ecdsa,
          vaultName: 'TestSecureVault'
        }
      ]

      await VaultManager.addAddressBookEntry(vaultEntries)

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.vaults).toHaveLength(4)

      // Verify vault separation
      const fastVaultEntries = addressBook.vaults.filter(e => e.vaultId === fastVault.data.publicKeys.ecdsa)
      const secureVaultEntries = addressBook.vaults.filter(e => e.vaultId === secureVault.data.publicKeys.ecdsa)

      expect(fastVaultEntries).toHaveLength(2)
      expect(secureVaultEntries).toHaveLength(2)

      // Verify addresses are different
      expect(fastVaultEntries[0].address).not.toBe(secureVaultEntries[0].address)
      expect(fastVaultEntries[1].address).not.toBe(secureVaultEntries[1].address)
    })
  })

  describe('AddressBook Filtering', () => {
    beforeEach(async () => {
      const entries: AddressBookEntry[] = [
        // Saved entries
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'FastVault BTC',
          source: 'saved'
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'FastVault ETH',
          source: 'saved'
        },
        {
          chain: 'solana',
          address: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR',
          name: 'FastVault SOL',
          source: 'saved'
        },
        // Vault entries
        {
          chain: 'bitcoin',
          address: 'bc1qg7gldwlccw9qeyzpew37hetu2ys042wnu2n3l4',
          name: 'SecureVault BTC',
          source: 'vaults',
          vaultId: 'test-vault-id',
          vaultName: 'TestSecureVault'
        }
      ]

      await VaultManager.addAddressBookEntry(entries)
    })

    test('should filter by chain', async () => {
      const btcAddressBook = await VaultManager.addressBook('bitcoin')
      const ethAddressBook = await VaultManager.addressBook('ethereum')
      const solAddressBook = await VaultManager.addressBook('solana')

      expect(btcAddressBook.saved).toHaveLength(1)
      expect(btcAddressBook.vaults).toHaveLength(1)
      expect(ethAddressBook.saved).toHaveLength(1)
      expect(ethAddressBook.vaults).toHaveLength(0)
      expect(solAddressBook.saved).toHaveLength(1)
      expect(solAddressBook.vaults).toHaveLength(0)

      expect(btcAddressBook.saved[0].chain).toBe('bitcoin')
      expect(btcAddressBook.vaults[0].chain).toBe('bitcoin')
    })

    test('should return all entries when no chain filter', async () => {
      const addressBook = await VaultManager.addressBook()

      expect(addressBook.saved).toHaveLength(3)
      expect(addressBook.vaults).toHaveLength(1)

      const chains = [...addressBook.saved.map(e => e.chain), ...addressBook.vaults.map(e => e.chain)]
      expect(chains).toContain('bitcoin')
      expect(chains).toContain('ethereum')
      expect(chains).toContain('solana')
    })
  })

  describe('AddressBook Updates', () => {
    test('should prevent duplicate addresses in saved entries', async () => {
      const originalEntry: AddressBookEntry = {
        chain: 'bitcoin',
        address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        name: 'Original Name',
        source: 'saved'
      }

      const duplicateEntry: AddressBookEntry = {
        chain: 'bitcoin',
        address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        name: 'Duplicate Name',
        source: 'saved'
      }

      await VaultManager.addAddressBookEntry([originalEntry])
      await VaultManager.addAddressBookEntry([duplicateEntry])

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(1)
      expect(addressBook.saved[0].name).toBe('Original Name') // Original should be preserved
    })

    test('should update address book entry name', async () => {
      const entry: AddressBookEntry = {
        chain: 'bitcoin',
        address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        name: 'Original Name',
        source: 'saved'
      }

      await VaultManager.addAddressBookEntry([entry])

      // Update the name
      await VaultManager.updateAddressBookEntry(
        'bitcoin',
        'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        'Updated Name'
      )

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved[0].name).toBe('Updated Name')
    })

    test('should handle updating non-existent entry gracefully', async () => {
      // Try to update an entry that doesn't exist
      await expect(
        VaultManager.updateAddressBookEntry(
          'bitcoin',
          'nonexistent-address',
          'New Name'
        )
      ).resolves.not.toThrow()

      // Address book should remain empty
      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(0)
    })
  })

  describe('AddressBook Removal', () => {
    test('should remove specific address book entries', async () => {
      const entries: AddressBookEntry[] = [
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'BTC Address 1',
          source: 'saved'
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'ETH Address 1',
          source: 'saved'
        },
        {
          chain: 'solana',
          address: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR',
          name: 'SOL Address 1',
          source: 'saved'
        }
      ]

      await VaultManager.addAddressBookEntry(entries)

      // Remove one entry
      await VaultManager.removeAddressBookEntry([
        { chain: 'ethereum', address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c' }
      ])

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(2)

      // Verify the correct entry was removed
      const remainingChains = addressBook.saved.map(e => e.chain)
      expect(remainingChains).toContain('bitcoin')
      expect(remainingChains).toContain('solana')
      expect(remainingChains).not.toContain('ethereum')
    })

    test('should remove multiple entries at once', async () => {
      const entries: AddressBookEntry[] = [
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'BTC Address',
          source: 'saved'
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'ETH Address',
          source: 'saved'
        },
        {
          chain: 'solana',
          address: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR',
          name: 'SOL Address',
          source: 'saved'
        }
      ]

      await VaultManager.addAddressBookEntry(entries)

      // Remove multiple entries
      await VaultManager.removeAddressBookEntry([
        { chain: 'bitcoin', address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9' },
        { chain: 'solana', address: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR' }
      ])

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(1)
      expect(addressBook.saved[0].chain).toBe('ethereum')
    })

    test('should handle removing non-existent entries gracefully', async () => {
      const entry: AddressBookEntry = {
        chain: 'bitcoin',
        address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        name: 'BTC Address',
        source: 'saved'
      }

      await VaultManager.addAddressBookEntry([entry])

      // Try to remove a non-existent entry
      await VaultManager.removeAddressBookEntry([
        { chain: 'ethereum', address: 'nonexistent-address' }
      ])

      // Original entry should still exist
      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(1)
    })
  })

  describe('Complex AddressBook Scenarios', () => {
    test('should handle mixed saved and vault entries', async () => {
      // Import vault
      const vaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultBuffer = readFileSync(vaultPath)
      const vaultFile = new File([vaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
      ;(vaultFile as any).buffer = vaultBuffer

      const vault = await VaultManager.add(vaultFile, 'Password123!')

      // Add mixed entries
      const mixedEntries: AddressBookEntry[] = [
        // Saved entry
        {
          chain: 'bitcoin',
          address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          name: 'Satoshi BTC',
          source: 'saved'
        },
        // Vault entry from imported vault
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'TestFastVault ETH',
          source: 'vaults',
          vaultId: vault.data.publicKeys.ecdsa,
          vaultName: 'TestFastVault'
        }
      ]

      await VaultManager.addAddressBookEntry(mixedEntries)

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(1)
      expect(addressBook.vaults).toHaveLength(1)

      // Verify different sources
      expect(addressBook.saved[0].source).toBe('saved')
      expect(addressBook.vaults[0].source).toBe('vaults')
    })

    test('should handle addresses from multiple chains comprehensively', async () => {
      const comprehensiveEntries: AddressBookEntry[] = [
        // Bitcoin and altcoins
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'Test BTC',
          source: 'saved'
        },
        {
          chain: 'litecoin',
          address: 'ltc1qkdau9j2puxrsu0vlwa6q7cysq8ys97w2tk7whc',
          name: 'Test LTC',
          source: 'saved'
        },
        {
          chain: 'dogecoin',
          address: 'DTSParRZGeQSzPK2uTvzFCtsiWfTbwvmUZ',
          name: 'Test DOGE',
          source: 'saved'
        },
        // Ethereum ecosystem
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'Test ETH',
          source: 'saved'
        },
        {
          chain: 'polygon',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'Test MATIC',
          source: 'saved'
        },
        {
          chain: 'bsc',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'Test BSC',
          source: 'saved'
        },
        // Cosmos ecosystem
        {
          chain: 'cosmos',
          address: 'cosmos1axf2e8w0k73gp7zmfqcx7zssma34haxh7xwlsu',
          name: 'Test ATOM',
          source: 'saved'
        },
        {
          chain: 'osmosis',
          address: 'osmo1axf2e8w0k73gp7zmfqcx7zssma34haxhkaa0xw',
          name: 'Test OSMO',
          source: 'saved'
        },
        // Other chains
        {
          chain: 'solana',
          address: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR',
          name: 'Test SOL',
          source: 'saved'
        },
        {
          chain: 'thorchain',
          address: 'thor1nuwfr59wyn6da6v5ktxsa32v2t6u2q4veg9awu',
          name: 'Test RUNE',
          source: 'saved'
        }
      ]

      await VaultManager.addAddressBookEntry(comprehensiveEntries)

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(10)

      // Test filtering by various chains
      const btcBook = await VaultManager.addressBook('bitcoin')
      const ethBook = await VaultManager.addressBook('ethereum')
      const cosmosBook = await VaultManager.addressBook('cosmos')

      expect(btcBook.saved).toHaveLength(1)
      expect(ethBook.saved).toHaveLength(1)
      expect(cosmosBook.saved).toHaveLength(1)

      // Verify chain-specific addresses
      expect(btcBook.saved[0].address.startsWith('bc1')).toBe(true)
      expect(ethBook.saved[0].address.startsWith('0x')).toBe(true)
      expect(cosmosBook.saved[0].address.startsWith('cosmos')).toBe(true)
    })
  })
})
