import type { AddressBook, AddressBookEntry } from '../types'

/**
 * AddressBookManager handles global address book operations
 * Separated from VaultManager for better organization
 */
export class AddressBookManager {
  private static addressBookData: AddressBook = { saved: [], vaults: [] }

  /**
   * Get address book entries
   */
  static async get(chain?: string): Promise<AddressBook> {
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
  static async add(entries: AddressBookEntry[]): Promise<void> {
    for (const entry of entries) {
      // Route entry to appropriate array based on source
      if (entry.source === 'vaults') {
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
          existing => existing.chain === entry.chain && existing.address === entry.address
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
  }

  /**
   * Remove address book entries
   */
  static async remove(
    addresses: Array<{ chain: string; address: string }>
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
  }

  /**
   * Update address book entry name
   */
  static async update(
    chain: string,
    address: string,
    name: string
  ): Promise<void> {
    // Try to find and update in saved entries
    const savedEntry = this.addressBookData.saved.find(
      entry => entry.chain === chain && entry.address === address
    )

    if (savedEntry) {
      savedEntry.name = name
      return
    }

    // Try to find and update in vault entries
    const vaultEntry = this.addressBookData.vaults.find(
      entry => entry.chain === chain && entry.address === address
    )

    if (vaultEntry) {
      vaultEntry.name = name
    }
  }

  /**
   * Clear all address book data
   */
  static async clear(): Promise<void> {
    this.addressBookData = { saved: [], vaults: [] }
  }
}
