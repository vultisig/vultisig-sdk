import type { Chain } from '@core/chain/Chain'

import { AddressBook, AddressBookEntry } from './types'

/**
 * AddressBook manager for global address book operations
 * Handles saved addresses and addresses from user's other vaults
 */
export class AddressBookManager {
  private addressBookData: AddressBook = { saved: [], vaults: [] }

  /**
   * Get address book entries
   */
  async getAddressBook(chain?: Chain): Promise<AddressBook> {
    if (chain) {
      return {
        saved: this.addressBookData.saved.filter(
          entry => entry.chain === chain
        ),
        vaults: this.addressBookData.vaults.filter(
          entry => entry.chain === chain
        ),
      }
    }
    return { ...this.addressBookData }
  }

  /**
   * Add address book entries
   */
  async addAddressBookEntry(entries: AddressBookEntry[]): Promise<void> {
    for (const entry of entries) {
      // Route entry to appropriate array based on source
      if (entry.source === 'vault') {
        // Remove existing vault entry if it exists
        this.addressBookData.vaults = this.addressBookData.vaults.filter(
          existing =>
            !(
              existing.chain === entry.chain &&
              existing.address === entry.address &&
              existing.vaultId === entry.vaultId
            )
        )

        // Add new vault entry
        this.addressBookData.vaults.push({
          ...entry,
          dateAdded: Date.now(),
        })
      } else {
        // Check if saved entry already exists
        const existingIndex = this.addressBookData.saved.findIndex(
          existing =>
            existing.chain === entry.chain && existing.address === entry.address
        )

        if (existingIndex === -1) {
          // Add new saved entry if it doesn't exist
          this.addressBookData.saved.push({
            ...entry,
            dateAdded: Date.now(),
          })
        }
        // If it exists, do nothing (preserve original)
      }
    }
    // TODO: Persist to storage
  }

  /**
   * Remove address book entries
   */
  async removeAddressBookEntry(
    addresses: Array<{ chain: Chain; address: string }>
  ): Promise<void> {
    for (const { chain, address } of addresses) {
      // Remove from saved entries
      this.addressBookData.saved = this.addressBookData.saved.filter(
        entry => !(entry.chain === chain && entry.address === address)
      )

      // Remove from vault entries
      this.addressBookData.vaults = this.addressBookData.vaults.filter(
        entry => !(entry.chain === chain && entry.address === address)
      )
    }
    // TODO: Persist to storage
  }

  /**
   * Update address book entry name
   */
  async updateAddressBookEntry(
    chain: Chain,
    address: string,
    name: string
  ): Promise<void> {
    // Try to find and update in saved entries
    const savedEntry = this.addressBookData.saved.find(
      entry => entry.chain === chain && entry.address === address
    )

    if (savedEntry) {
      savedEntry.name = name
      // TODO: Persist to storage
      return
    }

    // Try to find and update in vault entries
    const vaultEntry = this.addressBookData.vaults.find(
      entry => entry.chain === chain && entry.address === address
    )

    if (vaultEntry) {
      vaultEntry.name = name
      // TODO: Persist to storage
    }
  }

  /**
   * Clear all address book data
   */
  clear(): void {
    this.addressBookData = { saved: [], vaults: [] }
  }
}
