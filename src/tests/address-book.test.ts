import { describe, test, expect, beforeEach, afterEach } from 'vitest'

import { VaultManager } from '../vault/VaultManager'
import type { AddressBookEntry } from '../types'

describe('AddressBook Tests', () => {
  beforeEach(async () => {
    await VaultManager.clear()
    VaultManager.init(null)
  })

  afterEach(async () => {
    await VaultManager.clear()
  })

  describe('Add/Remove Operations', () => {
    test('should add and remove single entry', async () => {
      const entry: AddressBookEntry = {
        chain: 'bitcoin',
        address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        name: 'Test BTC',
        source: 'saved'
      }

      // Add entry
      await VaultManager.addAddressBookEntry([entry])
      let addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(1)
      expect(addressBook.saved[0]).toMatchObject(entry)

      // Remove entry
      await VaultManager.removeAddressBookEntry([
        { chain: 'bitcoin', address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9' }
      ])
      addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(0)
    })

    test('should add and remove multiple entries', async () => {
      const entries: AddressBookEntry[] = [
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'Test BTC',
          source: 'saved'
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'Test ETH',
          source: 'saved'
        }
      ]

      // Add multiple entries
      await VaultManager.addAddressBookEntry(entries)
      let addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(2)

      // Remove all entries
      await VaultManager.removeAddressBookEntry([
        { chain: 'bitcoin', address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9' },
        { chain: 'ethereum', address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c' }
      ])
      addressBook = await VaultManager.addressBook()
      expect(addressBook.saved).toHaveLength(0)
    })
  })

  describe('Update Operations', () => {
    test('should update entry name', async () => {
      const entry: AddressBookEntry = {
        chain: 'bitcoin',
        address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        name: 'Original Name',
        source: 'saved'
      }

      await VaultManager.addAddressBookEntry([entry])
      await VaultManager.updateAddressBookEntry(
        'bitcoin',
        'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        'Updated Name'
      )

      const addressBook = await VaultManager.addressBook()
      expect(addressBook.saved[0].name).toBe('Updated Name')
    })
  })

  describe('Chain Filtering', () => {
    test('should filter entries by chain', async () => {
      const entries: AddressBookEntry[] = [
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'Test BTC',
          source: 'saved'
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'Test ETH',
          source: 'saved'
        }
      ]

      await VaultManager.addAddressBookEntry(entries)

      const btcBook = await VaultManager.addressBook('bitcoin')
      const ethBook = await VaultManager.addressBook('ethereum')

      expect(btcBook.saved).toHaveLength(1)
      expect(btcBook.saved[0].chain).toBe('bitcoin')
      expect(ethBook.saved).toHaveLength(1)
      expect(ethBook.saved[0].chain).toBe('ethereum')
    })
  })
})
