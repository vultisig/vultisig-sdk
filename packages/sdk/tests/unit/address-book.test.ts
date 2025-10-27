import { describe, test, expect, beforeEach, afterEach } from 'vitest'

import { Vultisig } from '../../src/VultisigSDK'
import type { AddressBookEntry } from '../types'

describe('AddressBook Tests', () => {
  let vultisig: Vultisig

  beforeEach(async () => {
    vultisig = new Vultisig()
    await vultisig.clearVaults()
  })

  afterEach(async () => {
    await vultisig.clearVaults()
  })

  describe('Add/Remove Operations', () => {
    test('should add and remove single entry', async () => {
      const entry: AddressBookEntry = {
        chain: 'bitcoin',
        address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        name: 'Test BTC',
        source: 'saved',
        dateAdded: Date.now(),
      }

      // Add entry
      await vultisig.addAddressBookEntry([entry])
      let addressBook = await vultisig.getAddressBook()
      expect(addressBook.saved).toHaveLength(1)
      expect(addressBook.saved[0]).toMatchObject(entry)

      // Validate dateAdded property
      expect(addressBook.saved[0].dateAdded).toBeDefined()
      expect(typeof addressBook.saved[0].dateAdded).toBe('number')
      expect(addressBook.saved[0].dateAdded).toBe(entry.dateAdded)

      // Remove entry
      await vultisig.removeAddressBookEntry([
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        },
      ])
      addressBook = await vultisig.getAddressBook()
      expect(addressBook.saved).toHaveLength(0)
    })

    test('should add and remove multiple entries', async () => {
      const entries: AddressBookEntry[] = [
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'Test BTC',
          source: 'saved',
          dateAdded: Date.now(),
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'Test ETH',
          source: 'saved',
          dateAdded: Date.now(),
        },
      ]

      // Add multiple entries
      await vultisig.addAddressBookEntry(entries)
      let addressBook = await vultisig.getAddressBook()
      expect(addressBook.saved).toHaveLength(2)

      // Validate dateAdded property for all entries
      addressBook.saved.forEach((savedEntry, index) => {
        expect(savedEntry.dateAdded).toBeDefined()
        expect(typeof savedEntry.dateAdded).toBe('number')
        expect(savedEntry.dateAdded).toBe(entries[index].dateAdded)
      })

      // Remove all entries
      await vultisig.removeAddressBookEntry([
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
        },
      ])
      addressBook = await vultisig.getAddressBook()
      expect(addressBook.saved).toHaveLength(0)
    })
  })

  describe('Update Operations', () => {
    test('should update entry name', async () => {
      const entry: AddressBookEntry = {
        chain: 'bitcoin',
        address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        name: 'Original Name',
        source: 'saved',
        dateAdded: Date.now(),
      }

      await vultisig.addAddressBookEntry([entry])
      await vultisig.updateAddressBookEntry(
        'bitcoin',
        'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        'Updated Name'
      )

      const addressBook = await vultisig.getAddressBook()
      expect(addressBook.saved[0].name).toBe('Updated Name')

      // Validate dateAdded is preserved after update
      expect(addressBook.saved[0].dateAdded).toBeDefined()
      expect(typeof addressBook.saved[0].dateAdded).toBe('number')
      expect(addressBook.saved[0].dateAdded).toBe(entry.dateAdded)
    })
  })

  describe('Chain Filtering', () => {
    test('should filter entries by chain', async () => {
      const entries: AddressBookEntry[] = [
        {
          chain: 'bitcoin',
          address: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
          name: 'Test BTC',
          source: 'saved',
          dateAdded: Date.now(),
        },
        {
          chain: 'ethereum',
          address: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
          name: 'Test ETH',
          source: 'saved',
          dateAdded: Date.now(),
        },
      ]

      await vultisig.addAddressBookEntry(entries)

      const btcBook = await vultisig.getAddressBook('bitcoin')
      const ethBook = await vultisig.getAddressBook('ethereum')

      expect(btcBook.saved).toHaveLength(1)
      expect(btcBook.saved[0].chain).toBe('bitcoin')
      expect(ethBook.saved).toHaveLength(1)
      expect(ethBook.saved[0].chain).toBe('ethereum')

      // Validate dateAdded property is preserved when filtering
      expect(btcBook.saved[0].dateAdded).toBeDefined()
      expect(typeof btcBook.saved[0].dateAdded).toBe('number')
      expect(btcBook.saved[0].dateAdded).toBe(entries[0].dateAdded)

      expect(ethBook.saved[0].dateAdded).toBeDefined()
      expect(typeof ethBook.saved[0].dateAdded).toBe('number')
      expect(ethBook.saved[0].dateAdded).toBe(entries[1].dateAdded)
    })
  })
})
