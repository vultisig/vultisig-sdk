import type { Chain } from "@core/chain/Chain";

import { GlobalStorage } from "./storage/GlobalStorage";
import type { Storage } from "./storage/types";
import { AddressBook, AddressBookEntry } from "./types";

/**
 * AddressBook manager for global address book operations
 * Handles saved addresses and addresses from user's other vaults
 */
export class AddressBookManager {
  private addressBookData: AddressBook = { saved: [], vaults: [] };
  private storage: Storage;

  constructor() {
    this.storage = GlobalStorage.getInstance();
  }

  /**
   * Initialize address book by loading data from storage
   */
  async init(): Promise<void> {
    const saved =
      await this.storage.get<AddressBookEntry[]>("addressBook:saved");
    const vaults =
      await this.storage.get<AddressBookEntry[]>("addressBook:vaults");

    this.addressBookData = {
      saved: saved ?? [],
      vaults: vaults ?? [],
    };
  }

  /**
   * Get address book entries
   */
  async getAddressBook(chain?: Chain): Promise<AddressBook> {
    if (chain) {
      return {
        saved: this.addressBookData.saved.filter(
          (entry) => entry.chain === chain,
        ),
        vaults: this.addressBookData.vaults.filter(
          (entry) => entry.chain === chain,
        ),
      };
    }
    return { ...this.addressBookData };
  }

  /**
   * Add address book entries
   */
  async addAddressBookEntry(entries: AddressBookEntry[]): Promise<void> {
    for (const entry of entries) {
      // Route entry to appropriate array based on source
      if (entry.source === "vault") {
        // Remove existing vault entry if it exists
        this.addressBookData.vaults = this.addressBookData.vaults.filter(
          (existing) =>
            !(
              existing.chain === entry.chain &&
              existing.address === entry.address &&
              existing.vaultId === entry.vaultId
            ),
        );

        // Add new vault entry
        this.addressBookData.vaults.push({
          ...entry,
          dateAdded: Date.now(),
        });
      } else {
        // Check if saved entry already exists
        const existingIndex = this.addressBookData.saved.findIndex(
          (existing) =>
            existing.chain === entry.chain &&
            existing.address === entry.address,
        );

        if (existingIndex === -1) {
          // Add new saved entry if it doesn't exist
          this.addressBookData.saved.push({
            ...entry,
            dateAdded: Date.now(),
          });
        }
        // If it exists, do nothing (preserve original)
      }
    }

    // Persist to storage
    await this.storage.set("addressBook:saved", this.addressBookData.saved);
    await this.storage.set("addressBook:vaults", this.addressBookData.vaults);
  }

  /**
   * Remove address book entries
   */
  async removeAddressBookEntry(
    addresses: Array<{ chain: Chain; address: string }>,
  ): Promise<void> {
    for (const { chain, address } of addresses) {
      // Remove from saved entries
      this.addressBookData.saved = this.addressBookData.saved.filter(
        (entry) => !(entry.chain === chain && entry.address === address),
      );

      // Remove from vault entries
      this.addressBookData.vaults = this.addressBookData.vaults.filter(
        (entry) => !(entry.chain === chain && entry.address === address),
      );
    }

    // Persist to storage
    await this.storage.set("addressBook:saved", this.addressBookData.saved);
    await this.storage.set("addressBook:vaults", this.addressBookData.vaults);
  }

  /**
   * Update address book entry name
   */
  async updateAddressBookEntry(
    chain: Chain,
    address: string,
    name: string,
  ): Promise<void> {
    // Try to find and update in saved entries
    const savedEntry = this.addressBookData.saved.find(
      (entry) => entry.chain === chain && entry.address === address,
    );

    if (savedEntry) {
      savedEntry.name = name;
      await this.storage.set("addressBook:saved", this.addressBookData.saved);
      return;
    }

    // Try to find and update in vault entries
    const vaultEntry = this.addressBookData.vaults.find(
      (entry) => entry.chain === chain && entry.address === address,
    );

    if (vaultEntry) {
      vaultEntry.name = name;
      await this.storage.set("addressBook:vaults", this.addressBookData.vaults);
    }
  }

  /**
   * Clear all address book data
   */
  async clear(): Promise<void> {
    this.addressBookData = { saved: [], vaults: [] };
    await this.storage.remove("addressBook:saved");
    await this.storage.remove("addressBook:vaults");
  }
}
