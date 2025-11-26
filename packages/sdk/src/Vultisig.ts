// ServerManager is internal - import directly from implementation file
import { Chain } from "@core/chain/Chain";
import { vaultContainerFromString } from "@core/mpc/vault/utils/vaultContainerFromString";

import { AddressBookManager } from "./AddressBookManager";
import { GlobalConfig } from "./config/GlobalConfig";
import { DEFAULT_CHAINS, SUPPORTED_CHAINS } from "./constants";
import { UniversalEventEmitter } from "./events/EventEmitter";
import type { SdkEvents } from "./events/types";
import { GlobalServerManager } from "./server/GlobalServerManager";
import { GlobalStorage } from "./storage/GlobalStorage";
import type { Storage } from "./storage/types";
import {
  AddressBook,
  AddressBookEntry,
  ServerStatus,
  VultisigConfig,
} from "./types";
import { VaultBase } from "./vault/VaultBase";
import { VaultManager } from "./VaultManager";
import { WasmManager } from "./wasm";

// Re-export constants
export { DEFAULT_CHAINS, SUPPORTED_CHAINS };

/**
 * Main Vultisig class providing secure multi-party computation and blockchain operations
 * Now with integrated storage, events, and connection management
 *
 * Uses global singletons for ServerManager and VaultConfig
 */
export class Vultisig extends UniversalEventEmitter<SdkEvents> {
  private _initialized = false;
  private initializationPromise?: Promise<void>;

  // Module managers
  private addressBookManager: AddressBookManager;
  private vaultManager: VaultManager;

  // Chain and currency configuration
  private _defaultChains: Chain[];
  private _defaultCurrency: string;

  // Storage state (kept for backward compatibility)
  public get storage(): Storage {
    return GlobalStorage.getInstance();
  }

  // Public readonly properties (exposed via getters)
  get initialized(): boolean {
    return this._initialized;
  }

  get defaultChains(): Chain[] {
    return [...this._defaultChains];
  }

  get defaultCurrency(): string {
    return this._defaultCurrency;
  }

  constructor(config?: VultisigConfig) {
    // Initialize EventEmitter
    super();

    // Configure global storage if provided
    if (config?.storage) {
      GlobalStorage.configure(config.storage);
    }

    // Configure global server manager
    if (config?.serverEndpoints) {
      GlobalServerManager.configure(config.serverEndpoints);
    }

    // Configure global config
    GlobalConfig.configure({
      defaultChains: config?.defaultChains,
      defaultCurrency: config?.defaultCurrency,
      cacheConfig: config?.cacheConfig,
      passwordCache: config?.passwordCache,
      onPasswordRequired: config?.onPasswordRequired,
    });

    // Note: WASM is configured automatically by platform bundles at module load time
    // Users should not configure WASM directly

    // Initialize chain and currency configuration
    this._defaultChains = config?.defaultChains ?? DEFAULT_CHAINS;
    this._defaultCurrency = config?.defaultCurrency ?? "USD";

    // Initialize module managers (no parameters needed)
    this.addressBookManager = new AddressBookManager();
    this.vaultManager = new VaultManager();

    // Auto-initialization
    if (config?.autoInit) {
      this.initialize().catch((err) => this.emit("error", err));
    }

    // Auto-connection (deprecated, now same as autoInit)
    if (config?.autoConnect) {
      this.initialize().catch((err) => this.emit("error", err));
    }
  }

  /**
   * Load configuration from storage
   * @private
   */
  private async loadConfigFromStorage(): Promise<void> {
    try {
      // Load default currency
      const storedCurrency = await this.storage.get<string>(
        "config:defaultCurrency",
      );
      if (storedCurrency) {
        this._defaultCurrency = storedCurrency;
      }
    } catch {
      // Ignore errors when loading currency (use constructor default)
    }

    try {
      // Load default chains
      const storedChains = await this.storage.get<Chain[]>(
        "config:defaultChains",
      );
      if (storedChains) {
        this._defaultChains = storedChains;
      }
    } catch {
      // Ignore errors when loading chains (use constructor default)
    }
  }

  /**
   * Internal auto-initialization helper
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Initialize the SDK and pre-load all WASM modules (optional but recommended)
   * WASM modules will lazy-load automatically when needed, but calling this
   * upfront can improve performance by avoiding delays during operations
   *
   * Thread-safe: Multiple concurrent calls will share the same initialization promise
   */
  async initialize(): Promise<void> {
    // Already initialized
    if (this.initialized) return;

    // Initialization in progress - return existing promise to prevent duplicate initialization
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start new initialization
    this.initializationPromise = (async () => {
      try {
        // Initialize platform-specific items
        await WasmManager.initialize();

        // Load configuration from storage
        await this.loadConfigFromStorage();

        // Initialize managers
        await this.addressBookManager.init();
        await this.vaultManager.init();

        this._initialized = true;
      } catch (error) {
        // Reset promise on error so initialization can be retried
        this.initializationPromise = undefined;
        throw new Error(
          "Failed to initialize SDK: " + (error as Error).message,
        );
      }
    })();

    return this.initializationPromise;
  }

  // === VAULT LIFECYCLE ===

  /**
   * Verify fast vault with email code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    await this.ensureInitialized();
    const serverManager = GlobalServerManager.getInstance();
    return serverManager.verifyVault(vaultId, code);
  }

  /**
   * Check if a vault file is encrypted
   *
   * @param vultContent - The .vult file content as a string
   * @returns true if the vault is encrypted, false otherwise
   *
   * @example
   * ```typescript
   * const vultContent = fs.readFileSync('vault.vult', 'utf-8')
   * if (sdk.isVaultEncrypted(vultContent)) {
   *   const password = await promptForPassword()
   *   const vault = await sdk.importVault(vultContent, password)
   * } else {
   *   const vault = await sdk.importVault(vultContent)
   * }
   * ```
   */
  isVaultEncrypted(vultContent: string): boolean {
    const container = vaultContainerFromString(vultContent.trim());
    return container.isEncrypted;
  }

  /**
   * Import vault from .vult file content (sets as active)
   *
   * @param vultContent - The .vult file content as a string
   * @param password - Optional password for encrypted vaults
   * @returns Imported vault instance
   *
   * @example
   * ```typescript
   * const vultContent = fs.readFileSync('vault.vult', 'utf-8')
   * const vault = await sdk.importVault(vultContent, 'password123')
   * ```
   */
  async importVault(
    vultContent: string,
    password?: string,
  ): Promise<VaultBase> {
    await this.ensureInitialized();
    const vault = await this.vaultManager.importVault(vultContent, password);

    // VaultManager already handles storage, just emit event
    this.emit("vaultChanged", { vaultId: vault.id });

    return vault;
  }

  /**
   * List all stored vaults as Vault instances
   *
   * @returns Array of Vault class instances
   * @example
   * ```typescript
   * const vaults = await sdk.listVaults()
   * vaults.forEach(vault => {
   *   const summary = vault.summary()
   *   console.log(summary.name)
   * })
   * ```
   */
  async listVaults(): Promise<VaultBase[]> {
    await this.ensureInitialized();
    return this.vaultManager.listVaults();
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(vault: VaultBase): Promise<void> {
    await this.ensureInitialized();
    const vaultId = vault.id;

    // Delete from VaultManager (which handles all storage)
    await this.vaultManager.deleteVault(vaultId);

    // Emit event with empty vaultId to indicate no active vault
    this.emit("vaultChanged", { vaultId: "" });
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    await this.ensureInitialized();
    await this.vaultManager.clearVaults();
    await this.storage.clear();
    this.addressBookManager.clear();
    this.emit("vaultChanged", { vaultId: "" });
  }

  // === ACTIVE VAULT MANAGEMENT ===

  /**
   * Switch to different vault or clear active vault
   * @param vault - Vault to set as active, or null to clear active vault
   */
  async setActiveVault(vault: VaultBase | null): Promise<void> {
    await this.vaultManager.setActiveVault(vault?.id ?? null);
    this.emit("vaultChanged", { vaultId: vault?.id ?? "" });
  }

  /**
   * Get current active vault
   */
  async getActiveVault(): Promise<VaultBase | null> {
    return this.vaultManager.getActiveVault();
  }

  /**
   * Check if there's an active vault
   */
  async hasActiveVault(): Promise<boolean> {
    return this.vaultManager.hasActiveVault();
  }

  /**
   * Get vault instance by ID
   *
   * @param vaultId - Vault ID (ECDSA public key)
   * @returns Vault instance or null if not found
   */
  async getVaultById(vaultId: string): Promise<VaultBase | null> {
    return this.vaultManager.getVaultById(vaultId);
  }

  // === GLOBAL CONFIGURATION ===

  /**
   * Set global default currency
   */
  async setDefaultCurrency(currency: string): Promise<void> {
    this._defaultCurrency = currency;
    await this.storage.set("config:defaultCurrency", currency);
  }

  // === CHAIN OPERATIONS ===

  /**
   * Set SDK-level default chains for new vaults
   */
  async setDefaultChains(chains: Chain[]): Promise<void> {
    this._defaultChains = chains;
    await this.storage.set("config:defaultChains", chains);
  }

  // === FILE OPERATIONS ===

  /**
   * Check if .vult file is encrypted
   */
  /**
   * Check if .vult file content is encrypted
   * @param vultContent - The .vult file content as a string
   * @returns true if encrypted, false otherwise
   */
  async isVaultContentEncrypted(vultContent: string): Promise<boolean> {
    return this.vaultManager.isVaultContentEncrypted(vultContent);
  }

  // === SERVER STATUS ===

  /**
   * Check server connectivity
   */
  async getServerStatus(): Promise<ServerStatus> {
    const serverManager = GlobalServerManager.getInstance();
    return serverManager.checkServerStatus();
  }

  // === ADDRESS BOOK (GLOBAL) ===

  /**
   * Get address book entries
   */
  async getAddressBook(chain?: Chain): Promise<AddressBook> {
    return this.addressBookManager.getAddressBook(chain);
  }

  /**
   * Add address book entries
   */
  async addAddressBookEntry(entries: AddressBookEntry[]): Promise<void> {
    return this.addressBookManager.addAddressBookEntry(entries);
  }

  /**
   * Remove address book entries
   */
  async removeAddressBookEntry(
    addresses: Array<{ chain: Chain; address: string }>,
  ): Promise<void> {
    return this.addressBookManager.removeAddressBookEntry(addresses);
  }

  /**
   * Update address book entry name
   */
  async updateAddressBookEntry(
    chain: Chain,
    address: string,
    name: string,
  ): Promise<void> {
    return this.addressBookManager.updateAddressBookEntry(chain, address, name);
  }

  // === CONVENIENCE GETTERS FOR GLOBAL SINGLETONS ===

  /**
   * Get the global storage instance
   */
  get serverManager() {
    return GlobalServerManager.getInstance();
  }

  /**
   * Get the global configuration
   */
  get config() {
    return GlobalConfig.getInstance();
  }
}
