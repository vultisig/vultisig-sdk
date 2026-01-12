import { Chain } from '@core/chain/Chain'
import { getBlockExplorerUrl } from '@core/chain/utils/getBlockExplorerUrl'
import { isValidAddress } from '@core/chain/utils/isValidAddress'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'

import { AddressBookManager } from './AddressBookManager'
import { DEFAULT_CHAINS, SUPPORTED_CHAINS } from './constants'
import { getDefaultStorage } from './context/defaultStorage'
import type { VaultContext } from './context/SdkContext'
import type { SdkConfigOptions, SdkContext } from './context/SdkContext'
import { SdkContextBuilder, type SdkContextBuilderOptions } from './context/SdkContextBuilder'
import { UniversalEventEmitter } from './events/EventEmitter'
import type { SdkEvents } from './events/types'
import { ChainDiscoveryService } from './seedphrase/ChainDiscoveryService'
import { SeedphraseValidator } from './seedphrase/SeedphraseValidator'
import type {
  ChainDiscoveryProgress,
  ChainDiscoveryResult,
  ImportSeedphraseAsFastVaultOptions,
  ImportSeedphraseAsSecureVaultOptions,
  SeedphraseValidation,
} from './seedphrase/types'
import { FastSigningService } from './services/FastSigningService'
import { FastVaultSeedphraseImportService } from './services/FastVaultSeedphraseImportService'
import { SecureVaultSeedphraseImportService } from './services/SecureVaultSeedphraseImportService'
import type { Storage } from './storage/types'
import { AddressBook, AddressBookEntry, ServerStatus, VaultCreationStep } from './types'
import { createVaultBackup } from './utils/export'
import { FastVault } from './vault/FastVault'
import { SecureVault } from './vault/SecureVault'
import { VaultBase } from './vault/VaultBase'
import { VaultError, VaultErrorCode } from './vault/VaultError'
import { VaultManager } from './VaultManager'

// Re-export constants
export { DEFAULT_CHAINS, SUPPORTED_CHAINS }

/**
 * Configuration options for Vultisig SDK
 */
export type VultisigConfig = {
  /** Storage implementation (optional - uses platform default if not provided) */
  storage?: Storage
  /** Optional server endpoints override */
  serverEndpoints?: SdkContextBuilderOptions['serverEndpoints']
  /** Default chains for new vaults */
  defaultChains?: Chain[]
  /** Default fiat currency */
  defaultCurrency?: string
  /** Cache configuration */
  cacheConfig?: SdkConfigOptions['cacheConfig']
  /** Password cache configuration */
  passwordCache?: SdkConfigOptions['passwordCache']
  /** Callback for password requests */
  onPasswordRequired?: SdkConfigOptions['onPasswordRequired']
  /** Auto-initialize on construction */
  autoInit?: boolean
}

/**
 * Main Vultisig class providing secure multi-party computation and blockchain operations
 *
 * Instance-scoped: Each Vultisig instance manages its own dependencies via SdkContext.
 * This design allows multiple independent SDK instances in the same process.
 *
 * @example
 * ```typescript
 * const sdk = new Vultisig({
 *   storage: new MemoryStorage(),
 *   defaultChains: [Chain.Bitcoin, Chain.Ethereum],
 *   onPasswordRequired: async (vaultId, vaultName) => {
 *     return promptUser(`Enter password for ${vaultName}`)
 *   }
 * })
 *
 * await sdk.initialize()
 * const vault = await sdk.importVault(vultContent, password)
 *
 * // When done, dispose to clean up resources
 * sdk.dispose()
 * ```
 */
export class Vultisig extends UniversalEventEmitter<SdkEvents> {
  private _initialized = false
  private _disposed = false
  private initializationPromise?: Promise<void>

  // Instance-scoped context with all dependencies
  private readonly context: SdkContext

  // Module managers
  private readonly addressBookManager: AddressBookManager
  private readonly vaultManager: VaultManager

  // Pending vaults awaiting email verification (not yet persisted to storage)
  private readonly pendingVaults: Map<string, FastVault> = new Map()

  // Chain and currency configuration
  private _defaultChains: Chain[]
  private _defaultCurrency: string

  /**
   * Get the storage instance for this SDK
   */
  public get storage(): Storage {
    return this.context.storage
  }

  /**
   * Check if SDK is initialized
   */
  get initialized(): boolean {
    return this._initialized
  }

  /**
   * Check if SDK has been disposed
   */
  get disposed(): boolean {
    return this._disposed
  }

  /**
   * Get default chains configuration
   */
  get defaultChains(): Chain[] {
    return [...this._defaultChains]
  }

  /**
   * Get default currency
   */
  get defaultCurrency(): string {
    return this._defaultCurrency
  }

  /**
   * Create a new Vultisig SDK instance
   *
   * @param config - Configuration options (storage uses platform default if not provided)
   */
  constructor(config: VultisigConfig = {}) {
    super()

    // Use provided storage or platform default
    const storage = config.storage ?? getDefaultStorage()

    // Build SdkContext from config
    const builder = new SdkContextBuilder().withStorage(storage).withConfig({
      defaultChains: config.defaultChains,
      defaultCurrency: config.defaultCurrency,
      cacheConfig: config.cacheConfig,
      passwordCache: config.passwordCache,
      onPasswordRequired: config.onPasswordRequired,
    })

    if (config.serverEndpoints) {
      builder.withServerEndpoints(config.serverEndpoints)
    }

    this.context = builder.build()

    // Initialize chain and currency configuration
    this._defaultChains = config.defaultChains ?? DEFAULT_CHAINS
    this._defaultCurrency = config.defaultCurrency ?? 'USD'

    // Initialize module managers with context dependencies
    this.addressBookManager = new AddressBookManager(this.context.storage)
    this.vaultManager = new VaultManager(this.context)

    // Auto-initialization
    if (config.autoInit) {
      this.initialize().catch(err => this.emit('error', err))
    }
  }

  /**
   * Throw if SDK has been disposed
   */
  private ensureNotDisposed(): void {
    if (this._disposed) {
      throw new Error('Vultisig instance has been disposed. Create a new instance.')
    }
  }

  /**
   * Load configuration from storage
   * @private
   */
  private async loadConfigFromStorage(): Promise<void> {
    try {
      // Load default currency
      const storedCurrency = await this.context.storage.get<string>('config:defaultCurrency')
      if (storedCurrency) {
        this._defaultCurrency = storedCurrency
      }
    } catch {
      // Ignore errors when loading currency (use constructor default)
    }

    try {
      // Load default chains
      const storedChains = await this.context.storage.get<Chain[]>('config:defaultChains')
      if (storedChains) {
        this._defaultChains = storedChains
      }
    } catch {
      // Ignore errors when loading chains (use constructor default)
    }
  }

  /**
   * Internal auto-initialization helper
   */
  private async ensureInitialized(): Promise<void> {
    this.ensureNotDisposed()
    if (!this.initialized) {
      await this.initialize()
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
    this.ensureNotDisposed()

    // Already initialized
    if (this.initialized) return

    // Initialization in progress - return existing promise to prevent duplicate initialization
    if (this.initializationPromise) {
      return this.initializationPromise
    }

    // Start new initialization
    this.initializationPromise = (async () => {
      try {
        // Initialize WASM (WalletCore, DKLS, Schnorr) via context's WasmProvider
        await this.context.wasmProvider.getWalletCore()

        // Load configuration from storage
        await this.loadConfigFromStorage()

        // Initialize managers
        await this.addressBookManager.init()
        await this.vaultManager.init()

        this._initialized = true
      } catch (error) {
        // Reset promise on error so initialization can be retried
        this.initializationPromise = undefined
        throw new Error('Failed to initialize SDK: ' + (error as Error).message)
      }
    })()

    return this.initializationPromise
  }

  /**
   * Dispose this SDK instance and release resources
   *
   * After calling dispose():
   * - Password cache is destroyed (passwords zeroed in memory)
   * - Pending (unverified) vaults are discarded
   * - All method calls will throw
   * - A new Vultisig instance must be created to continue
   *
   * Note: WASM modules are shared process-wide and are NOT unloaded
   */
  dispose(): void {
    if (this._disposed) {
      return // Already disposed
    }

    // Clear pending vaults (unverified vaults are discarded)
    this.pendingVaults.clear()

    // Destroy password cache (zeros passwords in memory)
    this.context.passwordCache.destroy()

    // Mark as disposed
    this._disposed = true

    // Emit disposed event
    this.emit('disposed', {})
  }

  // === VAULT LIFECYCLE ===

  /**
   * Verify fast vault with email code and get the vault
   *
   * On successful verification, the pending vault is saved to storage, set as active,
   * and returned. Throws an error if verification fails or if no pending vault exists.
   *
   * @param vaultId - The vault ID to verify
   * @param code - The verification code from email
   * @returns The verified and persisted FastVault
   * @throws VaultError if verification fails or no pending vault found
   */
  async verifyVault(vaultId: string, code: string): Promise<FastVault> {
    await this.ensureInitialized()

    const pendingVault = this.pendingVaults.get(vaultId)
    if (!pendingVault) {
      throw new VaultError(
        VaultErrorCode.InvalidVault,
        'No pending vault found for this ID. Create a vault first with createFastVault().'
      )
    }

    const success = await this.context.serverManager.verifyVault(vaultId, code)

    if (!success) {
      throw new VaultError(VaultErrorCode.InvalidConfig, 'Verification failed. Check the code and try again.')
    }

    // Save and activate the vault
    await pendingVault.save()
    await this.vaultManager.setActiveVault(vaultId)
    this.pendingVaults.delete(vaultId)
    this.emit('vaultChanged', { vaultId })

    return pendingVault
  }

  /**
   * Resend vault verification email
   * Requires email and password to authenticate with the server
   */
  async resendVaultVerification(options: { vaultId: string; email: string; password: string }): Promise<void> {
    await this.ensureInitialized()
    return this.context.serverManager.resendVaultVerification(options)
  }

  /**
   * Create a new fast vault (2-of-2 with VultiServer)
   *
   * The vault is created in memory but NOT persisted until email verification succeeds.
   * Call `verifyVault()` with the email code to complete creation and get the vault.
   *
   * @param options - Vault creation options
   * @returns Vault ID (call verifyVault with this ID to get the vault)
   *
   * @example
   * ```typescript
   * const vaultId = await sdk.createFastVault({
   *   name: 'My Fast Vault',
   *   password: 'securePassword123',
   *   email: 'user@example.com',
   *   onProgress: (step) => console.log(step.message)
   * })
   *
   * // User receives email with verification code
   * const code = await promptUser('Enter verification code:')
   * const vault = await sdk.verifyVault(vaultId, code)
   *
   * // Now use the vault
   * const address = await vault.address(Chain.Bitcoin)
   * ```
   */
  async createFastVault(options: {
    name: string
    password: string
    email: string
    onProgress?: (step: VaultCreationStep) => void
  }): Promise<string> {
    await this.ensureInitialized()
    const result = await FastVault.create(this.context, options)

    // Store vault in pending map - it will be saved after email verification succeeds
    this.pendingVaults.set(result.vaultId, result.vault)

    // Return vaultId - vault is returned from verifyVault() after successful verification
    return result.vaultId
  }

  /**
   * Create a new secure vault (multi-device MPC)
   *
   * @param options - Vault creation options
   * @returns Created vault and session info
   *
   * @example
   * ```typescript
   * const result = await sdk.createSecureVault({
   *   name: 'My Secure Vault',
   *   password: 'securePassword123',
   *   devices: 3,
   *   threshold: 2,
   *   onProgress: (step) => console.log(step.message),
   *   onQRCodeReady: (qrPayload) => displayQR(qrPayload),
   *   onDeviceJoined: (deviceId, total, required) => console.log(`${total}/${required}`)
   * })
   * ```
   */
  async createSecureVault(options: {
    name: string
    password: string
    devices: number
    threshold?: number
    onProgress?: (step: VaultCreationStep) => void
    onQRCodeReady?: (qrPayload: string) => void
    onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
  }): Promise<{
    vault: SecureVault
    vaultId: string
    sessionId: string
  }> {
    await this.ensureInitialized()
    const result = await SecureVault.create(this.context, options)

    // Store the vault and set as active
    await result.vault.save()
    await this.vaultManager.setActiveVault(result.vaultId)

    this.emit('vaultChanged', { vaultId: result.vaultId })
    return result
  }

  // === SEEDPHRASE IMPORT ===

  /**
   * Validate a BIP39 seedphrase (mnemonic)
   *
   * @param mnemonic - The seedphrase to validate (space-separated words)
   * @returns Validation result with word count and any errors
   *
   * @example
   * ```typescript
   * const validation = await sdk.validateSeedphrase('abandon abandon abandon ...')
   * if (validation.valid) {
   *   console.log(`Valid ${validation.wordCount}-word seedphrase`)
   * } else {
   *   console.log(`Invalid: ${validation.error}`)
   * }
   * ```
   */
  async validateSeedphrase(mnemonic: string): Promise<SeedphraseValidation> {
    await this.ensureInitialized()
    const validator = new SeedphraseValidator(this.context.wasmProvider)
    return validator.validate(mnemonic)
  }

  /**
   * Discover chains with existing balances from a seedphrase
   *
   * Derives addresses for each chain and checks for non-zero balances.
   * Useful for determining which chains to include when importing a seedphrase.
   *
   * @param mnemonic - The seedphrase to derive addresses from
   * @param chains - Optional list of chains to scan (defaults to all supported)
   * @param onProgress - Optional progress callback
   * @returns Array of chain discovery results
   *
   * @example
   * ```typescript
   * const results = await sdk.discoverChainsFromSeedphrase(
   *   'abandon abandon abandon ...',
   *   [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
   *   (progress) => console.log(`${progress.chainsProcessed}/${progress.chainsTotal}`)
   * )
   *
   * const chainsWithBalance = results.filter(r => r.hasBalance)
   * console.log('Chains with funds:', chainsWithBalance.map(r => r.chain))
   * ```
   */
  async discoverChainsFromSeedphrase(
    mnemonic: string,
    chains?: Chain[],
    onProgress?: (progress: ChainDiscoveryProgress) => void
  ): Promise<ChainDiscoveryResult[]> {
    await this.ensureInitialized()
    const discoveryService = new ChainDiscoveryService(this.context.wasmProvider)
    return discoveryService.discoverChains(mnemonic, {
      config: { chains },
      onProgress,
    })
  }

  /**
   * Import a seedphrase as a FastVault (2-of-3 with VultiServer)
   *
   * Creates a FastVault from an existing BIP39 seedphrase. The vault requires
   * email verification before it can be used.
   *
   * @param options - Import options including mnemonic, name, password, and email
   * @returns Vault ID (call verifyVault with this ID and email code to get the vault)
   *
   * @example
   * ```typescript
   * const vaultId = await sdk.importSeedphraseAsFastVault({
   *   mnemonic: 'abandon abandon abandon ... about',
   *   name: 'Imported Wallet',
   *   password: 'securePassword',
   *   email: 'user@example.com',
   *   discoverChains: true,
   *   onProgress: (step) => console.log(step.message),
   *   onChainDiscovery: (progress) => console.log(`Scanning: ${progress.chain}`)
   * })
   *
   * // User receives email with verification code
   * const code = await promptUser('Enter verification code:')
   * const vault = await sdk.verifyVault(vaultId, code)
   * ```
   */
  async importSeedphraseAsFastVault(options: ImportSeedphraseAsFastVaultOptions): Promise<string> {
    await this.ensureInitialized()
    const importService = new FastVaultSeedphraseImportService(this.context)
    const result = await importService.importSeedphrase(options)

    // Create backup file from CoreVault
    const vultContent = await createVaultBackup(result.vault, options.password)

    // Create FastSigningService
    const fastSigningService = new FastSigningService(this.context.serverManager, this.context.wasmProvider)

    // Build VaultContext from SdkContext
    const vaultContext: VaultContext = {
      storage: this.context.storage,
      config: this.context.config,
      serverManager: this.context.serverManager,
      passwordCache: this.context.passwordCache,
      wasmProvider: this.context.wasmProvider,
    }

    // Create FastVault from import using the factory method
    const vault = FastVault.fromImport(result.vaultId, vultContent, result.vault, fastSigningService, vaultContext)

    // Cache password for unlocking
    this.context.passwordCache.set(result.vaultId, options.password)

    // Store in pending vaults - will be saved after email verification
    this.pendingVaults.set(result.vaultId, vault)

    return result.vaultId
  }

  /**
   * Import a seedphrase as a SecureVault (multi-device MPC)
   *
   * Creates a SecureVault from an existing BIP39 seedphrase using multi-device
   * coordination. Requires QR code scanning by other devices.
   *
   * @param options - Import options including mnemonic, name, device count
   * @returns Created vault, vault ID, and session ID
   *
   * @example
   * ```typescript
   * const result = await sdk.importSeedphraseAsSecureVault({
   *   mnemonic: 'abandon abandon abandon ... about',
   *   name: 'Imported Secure Wallet',
   *   devices: 2,
   *   discoverChains: true,
   *   onProgress: (step) => console.log(step.message),
   *   onQRCodeReady: (qrPayload) => displayQRCode(qrPayload),
   *   onDeviceJoined: (id, total, required) => console.log(`${total}/${required} devices`)
   * })
   *
   * console.log('Vault created:', result.vaultId)
   * ```
   */
  async importSeedphraseAsSecureVault(options: ImportSeedphraseAsSecureVaultOptions): Promise<{
    vault: SecureVault
    vaultId: string
    sessionId: string
    discoveredChains?: ChainDiscoveryResult[]
  }> {
    await this.ensureInitialized()
    const importService = new SecureVaultSeedphraseImportService(this.context)
    const result = await importService.importSeedphrase(options)

    // Create backup file from CoreVault (use password if provided, empty string otherwise)
    const vultContent = await createVaultBackup(result.vault, options.password || '')

    // Build VaultContext from SdkContext
    const vaultContext: VaultContext = {
      storage: this.context.storage,
      config: this.context.config,
      serverManager: this.context.serverManager,
      passwordCache: this.context.passwordCache,
      wasmProvider: this.context.wasmProvider,
    }

    // Create SecureVault from import using the factory method
    const vault = SecureVault.fromImport(result.vaultId, vultContent, result.vault, vaultContext)

    // Cache password if provided
    if (options.password) {
      this.context.passwordCache.set(result.vaultId, options.password)
    }

    // Save the vault and set as active
    await vault.save()
    await this.vaultManager.setActiveVault(result.vaultId)

    this.emit('vaultChanged', { vaultId: result.vaultId })

    return {
      vault,
      vaultId: result.vaultId,
      sessionId: result.sessionId,
      discoveredChains: result.discoveredChains,
    }
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
    const container = vaultContainerFromString(vultContent.trim())
    return container.isEncrypted
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
  async importVault(vultContent: string, password?: string): Promise<VaultBase> {
    await this.ensureInitialized()
    const vault = await this.vaultManager.importVault(vultContent, password)

    // VaultManager already handles storage, just emit event
    this.emit('vaultChanged', { vaultId: vault.id })

    return vault
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
    await this.ensureInitialized()
    return this.vaultManager.listVaults()
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(vault: VaultBase): Promise<void> {
    await this.ensureInitialized()
    const vaultId = vault.id

    // Delete from VaultManager (which handles all storage)
    await this.vaultManager.deleteVault(vaultId)

    // Emit event with empty vaultId to indicate no active vault
    this.emit('vaultChanged', { vaultId: '' })
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    await this.ensureInitialized()
    await this.vaultManager.clearVaults()
    await this.storage.clear()
    this.addressBookManager.clear()
    this.emit('vaultChanged', { vaultId: '' })
  }

  // === ACTIVE VAULT MANAGEMENT ===

  /**
   * Switch to different vault or clear active vault
   * @param vault - Vault to set as active, or null to clear active vault
   */
  async setActiveVault(vault: VaultBase | null): Promise<void> {
    await this.vaultManager.setActiveVault(vault?.id ?? null)
    this.emit('vaultChanged', { vaultId: vault?.id ?? '' })
  }

  /**
   * Get current active vault
   */
  async getActiveVault(): Promise<VaultBase | null> {
    return this.vaultManager.getActiveVault()
  }

  /**
   * Check if there's an active vault
   */
  async hasActiveVault(): Promise<boolean> {
    return this.vaultManager.hasActiveVault()
  }

  /**
   * Get vault instance by ID
   *
   * @param vaultId - Vault ID (ECDSA public key)
   * @returns Vault instance or null if not found
   */
  async getVaultById(vaultId: string): Promise<VaultBase | null> {
    return this.vaultManager.getVaultById(vaultId)
  }

  // === GLOBAL CONFIGURATION ===

  /**
   * Set global default currency
   */
  async setDefaultCurrency(currency: string): Promise<void> {
    this._defaultCurrency = currency
    await this.storage.set('config:defaultCurrency', currency)
  }

  // === CHAIN OPERATIONS ===

  /**
   * Set SDK-level default chains for new vaults
   */
  async setDefaultChains(chains: Chain[]): Promise<void> {
    this._defaultChains = chains
    await this.storage.set('config:defaultChains', chains)
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
    return this.vaultManager.isVaultContentEncrypted(vultContent)
  }

  // === SERVER STATUS ===

  /**
   * Check server connectivity
   */
  async getServerStatus(): Promise<ServerStatus> {
    return this.context.serverManager.checkServerStatus()
  }

  // === ADDRESS BOOK (GLOBAL) ===

  /**
   * Get address book entries
   */
  async getAddressBook(chain?: Chain): Promise<AddressBook> {
    return this.addressBookManager.getAddressBook(chain)
  }

  /**
   * Add address book entries
   *
   * @param entries - Address book entries to add
   * @throws Error if any address is invalid for its chain
   */
  async addAddressBookEntry(entries: AddressBookEntry[]): Promise<void> {
    // Validate all addresses before adding
    const walletCore = await this.context.wasmProvider.getWalletCore()

    for (const entry of entries) {
      const isValid = isValidAddress({
        chain: entry.chain,
        address: entry.address,
        walletCore,
      })

      if (!isValid) {
        throw new Error(`Invalid address for ${entry.chain}: ${entry.address}`)
      }
    }

    return this.addressBookManager.addAddressBookEntry(entries)
  }

  /**
   * Remove address book entries
   */
  async removeAddressBookEntry(addresses: Array<{ chain: Chain; address: string }>): Promise<void> {
    return this.addressBookManager.removeAddressBookEntry(addresses)
  }

  /**
   * Update address book entry name
   */
  async updateAddressBookEntry(chain: Chain, address: string, name: string): Promise<void> {
    return this.addressBookManager.updateAddressBookEntry(chain, address, name)
  }

  // === CONVENIENCE GETTERS ===

  /**
   * Get the configuration for this SDK instance
   */
  get config() {
    return this.context.config
  }

  /**
   * Get the WASM provider for this SDK instance
   */
  get wasmProvider() {
    return this.context.wasmProvider
  }

  // === STATIC UTILITY METHODS ===

  /**
   * Get the block explorer URL for a transaction
   * @param chain - The blockchain chain
   * @param txHash - The transaction hash
   * @returns The block explorer URL for the transaction
   */
  static getTxExplorerUrl(chain: Chain, txHash: string): string {
    return getBlockExplorerUrl({ chain, entity: 'tx', value: txHash })
  }

  /**
   * Get the block explorer URL for an address
   * @param chain - The blockchain chain
   * @param address - The wallet address
   * @returns The block explorer URL for the address
   */
  static getAddressExplorerUrl(chain: Chain, address: string): string {
    return getBlockExplorerUrl({ chain, entity: 'address', value: address })
  }

  /**
   * Type guard to check if a vault is a FastVault
   * @param vault - The vault to check
   * @returns true if the vault is a FastVault
   */
  static isFastVault(vault: VaultBase): vault is FastVault {
    return vault.type === 'fast'
  }

  /**
   * Type guard to check if a vault is a SecureVault
   * @param vault - The vault to check
   * @returns true if the vault is a SecureVault
   */
  static isSecureVault(vault: VaultBase): vault is SecureVault {
    return vault.type === 'secure'
  }
}
