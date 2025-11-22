// Core functions (functional dispatch) - Direct imports from core
import { fromBinary } from '@bufbuild/protobuf'
import { Chain } from '@core/chain/Chain'
import { AccountCoin } from '@core/chain/coin/AccountCoin'
import { FeeSettings } from '@core/mpc/keysign/chainSpecific/FeeSettings'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'

import { UniversalEventEmitter } from '../events/EventEmitter'
import { VaultEvents } from '../events/types'
import { MemoryStorage } from '../runtime/storage/MemoryStorage'
import type { Storage } from '../runtime/storage/types'
import { CacheScope, CacheService } from '../services/CacheService'
import { FastSigningService } from '../services/FastSigningService'
import { FiatValueService } from '../services/FiatValueService'
import { PasswordCacheService } from '../services/PasswordCacheService'
// Types
import {
  Balance,
  FiatCurrency,
  GasInfo,
  Signature,
  SigningMode,
  SigningPayload,
  Token,
  Value,
  VaultData,
} from '../types'
import { createVaultBackup } from '../utils/export'
// SDK utilities
import { DEFAULT_CHAINS } from '../Vultisig'
// Vault services
import { AddressService } from './services/AddressService'
import { BalanceService } from './services/BalanceService'
import { BroadcastService } from './services/BroadcastService'
import { GasEstimationService } from './services/GasEstimationService'
import { PreferencesService } from './services/PreferencesService'
import { TransactionBuilder } from './services/TransactionBuilder'
import { VaultError, VaultErrorCode } from './VaultError'
import { VaultConfig, VaultServices } from './VaultServices'

/**
 * Determine vault type based on signer names
 * Fast vaults have one signer that starts with "Server-"
 * Secure vaults have only device signers (no "Server-" prefix)
 */
function determineVaultType(signers: string[]): 'fast' | 'secure' {
  return signers.some(signer => signer.startsWith('Server-'))
    ? 'fast'
    : 'secure'
}

/**
 * Vault class - Functional Adapter Approach
 *
 * This class provides a thin layer over core functions, handling:
 * - Caching (addresses: permanent, balances: 5-min TTL)
 * - Format conversion (bigint → Balance, FeeQuote → GasInfo)
 * - Error handling and user-friendly messages
 * - Event emission for reactive updates
 *
 * Architecture:
 * - Vault → Core Functions (direct) → Chain Resolvers
 * - Aligns with core's functional dispatch pattern
 */
export class Vault extends UniversalEventEmitter<VaultEvents> {
  // Essential services only
  private cacheService: CacheService
  private fastSigningService?: FastSigningService
  private fiatValueService: FiatValueService
  private passwordCache: PasswordCacheService

  // Extracted services
  private addressService: AddressService
  private transactionBuilder: TransactionBuilder
  private balanceService: BalanceService
  private gasEstimationService: GasEstimationService
  private broadcastService: BroadcastService
  private preferencesService: PreferencesService

  // Runtime state (persisted via storage)
  private _userChains: Chain[] = []
  private _currency: string = 'usd'
  private _tokens: Record<string, Token[]> = {}

  // Storage for persistence (required)
  private storage: Storage

  // Vault configuration for password callback
  private config?: VaultConfig

  constructor(
    vaultId: number,
    name: string,
    vultFileContent: string,
    services: VaultServices,
    config?: VaultConfig,
    storage?: Storage,
    parsedVaultData?: CoreVault
  ) {
    // Initialize EventEmitter
    super()

    // Store config for password callback
    this.config = config

    // Inject essential services
    this.fastSigningService = services.fastSigningService
    // Use provided storage or default to in-memory storage
    this.storage = storage ?? new MemoryStorage()
    // Initialize cache service with storage support
    this.cacheService = new CacheService(
      this.storage,
      vaultId,
      config?.cacheConfig
    )
    // Initialize password cache service
    this.passwordCache = PasswordCacheService.getInstance(config?.passwordCache)

    // Parse vault container (synchronous) - or use provided parsed data
    let container: { isEncrypted: boolean; vault: string }
    let parsedVault: CoreVault

    if (parsedVaultData) {
      // Use pre-parsed vault data (for createFastVault with encrypted content)
      // This avoids trying to parse encrypted vault protobuf synchronously
      parsedVault = parsedVaultData

      // Determine if encrypted by checking the vault file content
      // If vultFileContent is provided, parse it to check encryption status
      if (vultFileContent && vultFileContent.trim()) {
        container = vaultContainerFromString(vultFileContent.trim())
      } else {
        // No vault file content - assume not encrypted (fast vault creation case)
        container = {
          isEncrypted: false,
          vault: '', // Not needed when using pre-parsed data
        }
      }
    } else {
      // Parse vault from vultFileContent string (for imports)
      try {
        container = vaultContainerFromString(vultFileContent.trim())

        // When password is provided to createVaultBackup(), the ENTIRE vault protobuf
        // (including metadata, signers, keyShares, etc.) is encrypted with AES-GCM.
        // We can only parse unencrypted vult files synchronously here.
        const vaultBase64 = container.vault

        if (container.isEncrypted) {
          // Cannot parse encrypted vault synchronously - need async decryption
          // This should not happen if parsedVaultData is properly provided
          throw new Error(
            'Cannot parse encrypted vault synchronously. Use parsedVaultData parameter.'
          )
        }

        // Parse unencrypted vault protobuf
        const vaultBinary = fromBase64(vaultBase64)
        const vaultProtobuf = fromBinary(VaultSchema, vaultBinary)
        parsedVault = fromCommVault(vaultProtobuf)
      } catch {
        // If parsing fails, create a minimal vault with just the name
        // This allows tests and edge cases to work with invalid vult content
        container = { isEncrypted: false, vault: '' }
        parsedVault = {
          name: name || 'Unknown Vault',
          publicKeys: { ecdsa: '', eddsa: '' },
          signers: ['local-party-1'],
          hexChainCode: '',
          localPartyId: 'local-party-1',
          createdAt: Date.now(),
          libType: 'GG20',
          isBackedUp: false,
          order: 0,
          keyShares: { ecdsa: '', eddsa: '' },
        }
      }
    }

    // Build CoreVault (without keyShares for now - lazy loaded)
    this.coreVault = {
      name: name || parsedVault.name,
      publicKeys: parsedVault.publicKeys,
      signers: parsedVault.signers,
      hexChainCode: parsedVault.hexChainCode,
      localPartyId: parsedVault.localPartyId,
      createdAt: parsedVault.createdAt || Date.now(),
      libType: parsedVault.libType,
      isBackedUp: parsedVault.isBackedUp ?? true,
      order: parsedVault.order ?? 0,
      keyShares: { ecdsa: '', eddsa: '' }, // Lazy-loaded from vaultFileContent
      folderId: parsedVault.folderId,
    }

    // Determine vault type
    const vaultType = determineVaultType(this.coreVault.signers as string[])

    // Build VaultData
    this.vaultData = {
      // Identity (readonly fields)
      publicKeys: this.coreVault.publicKeys,
      hexChainCode: this.coreVault.hexChainCode,
      signers: this.coreVault.signers,
      localPartyId: this.coreVault.localPartyId,
      createdAt: this.coreVault.createdAt,
      libType: this.coreVault.libType,

      // Metadata
      id: vaultId,
      name: this.coreVault.name,
      isEncrypted: container.isEncrypted,
      type: vaultType,
      isBackedUp: this.coreVault.isBackedUp,
      order: this.coreVault.order,
      folderId: this.coreVault.folderId,
      lastModified: Date.now(),

      // User Preferences
      currency: config?.defaultCurrency?.toLowerCase() || 'usd',
      chains: config?.defaultChains?.map(c => c.toString()) || [],
      tokens: {},

      // Vault file
      vultFileContent: vultFileContent.trim(),
    }

    // Initialize runtime state
    this._userChains =
      this.vaultData.chains.length > 0
        ? this.vaultData.chains.map(c => c as Chain)
        : (config?.defaultChains ?? DEFAULT_CHAINS)
    this._currency = this.vaultData.currency
    this._tokens = this.vaultData.tokens

    // Initialize fiat value service (now with portfolio support)
    this.fiatValueService = new FiatValueService(
      this.cacheService,
      () => this._currency as FiatCurrency,
      () => this._tokens,
      () => this._userChains,
      (chain, tokenId) => this.balance(chain, tokenId)
    )

    // Initialize extracted services
    this.addressService = new AddressService(this.coreVault, this.cacheService)
    this.transactionBuilder = new TransactionBuilder(this.coreVault)
    this.balanceService = new BalanceService(
      this.cacheService,
      data => this.emit('balanceUpdated', data),
      error => this.emit('error', error),
      chain => this.address(chain),
      chain => this.getTokens(chain),
      () => this._tokens,
      tokens => {
        this._tokens = tokens
      },
      () => this.save(),
      data => this.emit('tokenAdded', data),
      data => this.emit('tokenRemoved', data)
    )
    this.gasEstimationService = new GasEstimationService(
      this.coreVault,
      chain => this.address(chain)
    )
    this.broadcastService = new BroadcastService(keysignPayload =>
      this.extractMessageHashes(keysignPayload)
    )
    this.preferencesService = new PreferencesService(
      this.cacheService,
      () => this._userChains,
      chains => {
        this._userChains = chains
      },
      () => this._currency,
      currency => {
        this._currency = currency
      },
      async chains => {
        await this.addresses(chains)
      },
      () => this.save(),
      data => this.emit('chainAdded', data),
      data => this.emit('chainRemoved', data)
    )

    // Setup event-driven cache invalidation
    this.setupCacheInvalidation()
  }

  /**
   * Setup event-driven cache invalidation
   * Automatically invalidates relevant caches when vault state changes
   */
  private setupCacheInvalidation(): void {
    // When tokens are added/removed, invalidate balances and portfolio for that chain
    this.on('tokenAdded', async ({ chain }) => {
      await this.cacheService.invalidateByPrefix(
        `${CacheScope.BALANCE}:${chain.toLowerCase()}`
      )
      await this.cacheService.invalidateScope(CacheScope.PORTFOLIO)
    })

    this.on('tokenRemoved', async ({ chain }) => {
      await this.cacheService.invalidateByPrefix(
        `${CacheScope.BALANCE}:${chain.toLowerCase()}`
      )
      await this.cacheService.invalidateScope(CacheScope.PORTFOLIO)
    })
  }

  private vaultData: VaultData // Single source of truth
  private coreVault: CoreVault // Built from vaultData

  /**
   * Reconstruct a Vault instance from stored VaultData
   * Used when loading existing vaults from storage
   *
   * @param vaultData - Previously stored VaultData
   * @param services - Vault services (WASM, signing, etc.)
   * @param config - Optional configuration
   * @param storage - Storage instance (optional, defaults to in-memory)
   * @returns Vault instance
   */
  static fromStorage(
    vaultData: VaultData,
    services: VaultServices,
    config?: VaultConfig,
    storage?: Storage
  ): Vault {
    // Use the constructor with stored vult file content
    // The constructor will parse it (or handle empty content gracefully)
    const vault = new Vault(
      vaultData.id,
      vaultData.name,
      vaultData.vultFileContent || '', // Use stored content, empty string triggers fallback
      services,
      config,
      storage
    )

    // Override constructor defaults with stored preferences from VaultData
    // The constructor uses config defaults, but we want stored preferences
    // Only override if there are actual stored values (not empty/default)
    if (vaultData.chains && vaultData.chains.length > 0) {
      vault._userChains = vaultData.chains.map((c: string) => c as Chain)
    }
    if (vaultData.currency) {
      vault._currency = vaultData.currency
    }
    if (vaultData.tokens && Object.keys(vaultData.tokens).length > 0) {
      vault._tokens = vaultData.tokens
    }

    // Override vaultData to ensure all stored fields are preserved
    // (constructor built it from scratch, but we want the stored version)

    ;(vault as any).vaultData = vaultData

    // CRITICAL: Update coreVault with stored identity fields
    // This is necessary because the constructor may have created a fallback
    // coreVault with empty keys when vultFileContent was empty
    vault.coreVault.publicKeys = vaultData.publicKeys
    vault.coreVault.hexChainCode = vaultData.hexChainCode
    vault.coreVault.signers = [...vaultData.signers] // Copy readonly array to mutable
    vault.coreVault.localPartyId = vaultData.localPartyId
    vault.coreVault.libType = vaultData.libType
    vault.coreVault.createdAt = vaultData.createdAt

    return vault
  }

  // Add getter for id (no longer a constructor parameter)
  get id(): number {
    return this.vaultData.id
  }

  /**
   * Load preferences from storage
   */
  async loadPreferences(): Promise<void> {
    // Load vault data
    const loadedVaultData = await this.storage.get<VaultData>(
      `vault:${this.vaultData.id}`
    )
    if (loadedVaultData) {
      // Replace entire vaultData object

      ;(this as any).vaultData = loadedVaultData

      // Update runtime state
      this._currency = loadedVaultData.currency
      this._userChains = loadedVaultData.chains.map(c => c as Chain)
      this._tokens = loadedVaultData.tokens

      // Sync CoreVault with VaultData
      this.coreVault.name = loadedVaultData.name
      this.coreVault.isBackedUp = loadedVaultData.isBackedUp
      this.coreVault.order = loadedVaultData.order
    }

    // Initialize cache service (load persistent cache from storage)
    await this.cacheService.init()
  }

  /**
   * Save this vault to storage
   * Syncs runtime state to VaultData and persists atomically
   */
  async save(): Promise<void> {
    // Sync runtime state to vaultData

    const mutableData = this.vaultData as any
    mutableData.currency = this._currency
    mutableData.chains = this._userChains.map(c => c.toString())
    mutableData.tokens = this._tokens
    mutableData.lastModified = Date.now()

    // Sync CoreVault fields
    this.coreVault.name = this.vaultData.name
    this.coreVault.isBackedUp = this.vaultData.isBackedUp
    this.coreVault.order = this.vaultData.order

    // Persist to storage (cache is handled automatically by CacheService)
    await this.storage.set(`vault:${this.vaultData.id}`, this.vaultData)

    // Emit event
    this.emit('saved', { vaultId: this.vaultData.id })
  }

  // ===== VAULT INFO =====

  // ===== PUBLIC GETTERS FOR VAULTDATA ACCESS =====

  /**
   * Get the complete vault data
   * Use this to access all vault information
   */
  get data(): VaultData {
    return this.vaultData
  }

  // Identity fields (readonly)
  get name(): string {
    return this.vaultData.name
  }

  get publicKeys(): Readonly<{ ecdsa: string; eddsa: string }> {
    return this.vaultData.publicKeys
  }

  get hexChainCode(): string {
    return this.vaultData.hexChainCode
  }

  get signers(): Array<{ id: string; publicKey: string; name: string }> {
    return this.vaultData.signers.map((signerId, index) => ({
      id: signerId,
      publicKey: this.vaultData.publicKeys.ecdsa, // All signers share the same public key in TSS
      name: `Signer ${index + 1}`,
    }))
  }

  get localPartyId(): string {
    return this.vaultData.localPartyId
  }

  get createdAt(): number {
    return this.vaultData.createdAt
  }

  get libType(): string {
    return this.vaultData.libType
  }

  // Metadata fields
  get isEncrypted(): boolean {
    return this.vaultData.isEncrypted
  }

  get type(): 'fast' | 'secure' {
    return this.vaultData.type
  }

  get isBackedUp(): boolean {
    return this.vaultData.isBackedUp
  }

  get order(): number {
    return this.vaultData.order
  }

  get folderId(): string | undefined {
    return this.vaultData.folderId
  }

  get lastModified(): number {
    return this.vaultData.lastModified
  }

  // Computed fields (previously in Summary)
  /**
   * Calculate threshold based on total signers
   * For 2-of-2 (fast vaults), threshold is 2
   * For multi-sig (secure vaults), threshold is typically (n+1)/2
   */
  get threshold(): number {
    const totalSigners = this.vaultData.signers.length
    return totalSigners === 2 ? 2 : Math.ceil((totalSigners + 1) / 2)
  }

  /**
   * Get total number of signers
   */
  get totalSigners(): number {
    return this.vaultData.signers.length
  }

  /**
   * Get vault currency
   */
  get currency(): string {
    return this._currency
  }

  /**
   * Get all vault tokens (across all chains)
   */
  get tokens(): Record<string, Token[]> {
    return this._tokens
  }

  /**
   * Get vault keys (public keys and chain code)
   */
  get keys(): {
    ecdsa: string
    eddsa: string
    hexChainCode: string
    hexEncryptionKey: string
  } {
    return {
      ecdsa: this.vaultData.publicKeys.ecdsa,
      eddsa: this.vaultData.publicKeys.eddsa,
      hexChainCode: this.vaultData.hexChainCode,
      hexEncryptionKey: '', // Not used in current implementation
    }
  }

  /**
   * Rename vault
   */
  async rename(newName: string): Promise<void> {
    // Validate new name
    const validationResult = this.validateVaultName(newName)
    if (!validationResult.isValid) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        validationResult.errors?.[0] || 'Invalid vault name'
      )
    }

    const oldName = this.vaultData.name

    // Update VaultData (bypass readonly with type assertion)

    ;(this.vaultData as any).name = newName

    // Keep CoreVault in sync
    this.coreVault.name = newName

    // Persist changes
    await this.save()

    // Emit renamed event
    this.emit('renamed', { oldName, newName })
  }

  /**
   * Validate vault name
   */
  private validateVaultName(name: string): {
    isValid: boolean
    errors?: string[]
  } {
    const errors: string[] = []

    if (!name || name.trim().length === 0) {
      errors.push('Vault name cannot be empty')
    }

    if (name.length < 2) {
      errors.push('Vault name must be at least 2 characters long')
    }

    if (name.length > 50) {
      errors.push('Vault name cannot exceed 50 characters')
    }

    if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
      errors.push(
        'Vault name can only contain letters, numbers, spaces, hyphens, and underscores'
      )
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Export vault backup
   *
   * Returns the vault backup data as a base64 string along with the suggested filename.
   * The backup can be optionally encrypted with a password. The caller is responsible
   * for handling the data (e.g., downloading in browser, saving to file in Node.js).
   *
   * @param password - Optional password to encrypt the backup
   * @returns Object containing the filename and base64-encoded backup data
   *
   * @example
   * ```typescript
   * // Export unencrypted backup
   * const { filename, data } = await vault.export()
   *
   * // Export encrypted backup
   * const { filename, data } = await vault.export('mySecurePassword')
   *
   * // In a browser - download the file:
   * const { filename, data } = await vault.export()
   * const blob = new Blob([data], { type: 'application/octet-stream' })
   * initiateFileDownload({ blob, name: filename })
   *
   * // In Node.js - save to file:
   * const { filename, data } = await vault.export('password')
   * await fs.writeFile(filename, data, 'utf-8')
   * ```
   */
  async export(password?: string): Promise<{ filename: string; data: string }> {
    const totalSigners = this.vaultData.signers.length
    const localPartyIndex =
      this.vaultData.signers.indexOf(this.vaultData.localPartyId) + 1

    // Format: {vaultName}-{localPartyId}-share{index}of{total}.vult
    const filename = `${this.vaultData.name}-${this.vaultData.localPartyId}-share${localPartyIndex}of${totalSigners}.vult`

    // Generate base64-encoded backup (possibly encrypted)
    const data = await createVaultBackup(this.coreVault, password)

    return { filename, data }
  }

  // ===== PASSWORD MANAGEMENT =====

  /**
   * Lock this vault by removing password from cache
   * After locking, user will be prompted for password on next operation requiring it
   *
   * Note: This is a no-op for unencrypted vaults (they cannot be locked)
   */
  public lock(): void {
    if (!this.isVaultEncrypted()) {
      return // Cannot lock unencrypted vault
    }
    this.passwordCache.delete(this.id.toString())
  }

  /**
   * Unlock this vault by caching password
   * Password validity is verified by attempting to load key shares
   *
   * @param password - Password to cache
   * @throws {VaultError} If vault is unencrypted (nothing to unlock)
   * @throws {VaultError} If password is incorrect
   */
  public async unlock(password: string): Promise<void> {
    if (!this.isVaultEncrypted()) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'Cannot unlock unencrypted vault'
      )
    }

    // Temporarily cache password for verification
    this.passwordCache.set(this.id.toString(), password)

    try {
      // Verify password by attempting to load key shares
      await this.ensureKeySharesLoaded()
      // Password is valid and now cached
    } catch (error) {
      // Password is invalid - remove from cache
      this.passwordCache.delete(this.id.toString())
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Failed to unlock vault: ${error instanceof Error ? error.message : String(error)}`,
        error as Error
      )
    }
  }

  /**
   * Check if vault is unlocked (password cached)
   * - Unencrypted vaults are always "unlocked" (return true)
   * - Encrypted vaults check password cache
   *
   * @returns True if vault is unlocked and ready for operations
   */
  public isUnlocked(): boolean {
    if (!this.isVaultEncrypted()) {
      return true // Unencrypted vaults are always unlocked
    }
    return this.passwordCache.has(this.id.toString())
  }

  /**
   * Get remaining time before password cache expires
   *
   * @returns Milliseconds until expiry, or undefined if not cached or vault is unencrypted
   */
  public getUnlockTimeRemaining(): number | undefined {
    if (!this.isVaultEncrypted()) {
      return undefined // Unencrypted vaults don't have unlock time
    }
    return this.passwordCache.getRemainingTTL(this.id.toString())
  }

  /**
   * Delete this vault from storage
   * Removes vault data and persistent cache
   */
  async delete(): Promise<void> {
    // Remove vault data
    await this.storage.remove(`vault:${this.vaultData.id}`)

    // Remove persistent cache
    await this.storage.remove(`vault:${this.vaultData.id}:cache`)

    // Emit deleted event
    this.emit('deleted', { vaultId: this.vaultData.id })
  }

  /**
   * Reload vault data from storage
   * Refreshes the current instance with persisted state
   *
   * @throws {VaultError} If vault not found in storage
   */
  async load(): Promise<void> {
    const loadedVaultData = await this.storage.get<VaultData>(
      `vault:${this.vaultData.id}`
    )

    if (!loadedVaultData) {
      throw new VaultError(
        VaultErrorCode.InvalidVault,
        `Vault ${this.vaultData.id} not found in storage`
      )
    }

    // Replace vaultData

    ;(this as any).vaultData = loadedVaultData

    // Update runtime state
    this._currency = loadedVaultData.currency
    this._userChains = loadedVaultData.chains.map(c => c as Chain)
    this._tokens = loadedVaultData.tokens

    // Sync CoreVault
    this.coreVault.name = loadedVaultData.name
    this.coreVault.isBackedUp = loadedVaultData.isBackedUp
    this.coreVault.order = loadedVaultData.order

    // Initialize cache service (load persistent cache from storage)
    await this.cacheService.init()

    // Emit event
    this.emit('loaded', { vaultId: this.vaultData.id })
  }

  /**
   * Check if this vault exists in storage
   *
   * @returns true if vault exists, false otherwise
   */
  async exists(): Promise<boolean> {
    const vaultData = await this.storage.get<VaultData>(
      `vault:${this.vaultData.id}`
    )
    return vaultData !== null && vaultData !== undefined
  }

  // ===== ADDRESS METHODS =====

  /**
   * Get address for specified chain
   * Uses core's deriveAddress() with permanent caching
   */
  async address(chain: Chain): Promise<string> {
    return this.addressService.getAddress(chain)
  }

  /**
   * Get addresses for multiple chains
   */
  async addresses(chains?: Chain[]): Promise<Record<string, string>> {
    const chainsToDerive = chains ?? this._userChains
    return this.addressService.getAddresses(chainsToDerive)
  }

  // ===== BALANCE METHODS =====

  /**
   * Get balance for chain (with optional token)
   * Uses core's getCoinBalance() with 5-minute TTL cache
   */
  async balance(chain: Chain, tokenId?: string): Promise<Balance> {
    return this.balanceService.getBalance(chain, tokenId)
  }

  /**
   * Get balances for multiple chains
   */
  async balances(
    chains?: Chain[],
    includeTokens = false
  ): Promise<Record<string, Balance>> {
    const chainsToFetch = chains || this._userChains
    return this.balanceService.getBalances(chainsToFetch, includeTokens)
  }

  /**
   * Force refresh balance (clear cache)
   */
  async updateBalance(chain: Chain, tokenId?: string): Promise<Balance> {
    return this.balanceService.updateBalance(chain, tokenId)
  }

  /**
   * Force refresh multiple balances
   */
  async updateBalances(
    chains?: Chain[],
    includeTokens = false
  ): Promise<Record<string, Balance>> {
    const chainsToUpdate = chains || this._userChains
    return this.balanceService.updateBalances(chainsToUpdate, includeTokens)
  }

  // ===== GAS ESTIMATION =====

  /**
   * Get gas info for chain
   * Uses core's getChainSpecific() to estimate fees
   */
  async gas(chain: Chain): Promise<GasInfo> {
    return this.gasEstimationService.getGasInfo(chain)
  }

  // ===== TRANSACTION PREPARATION =====

  /**
   * Prepare a send transaction keysign payload
   *
   * This method builds a complete keysign payload for sending tokens or native coins.
   * The returned `KeysignPayload` can be passed directly to the `sign()` method.
   *
   * @param params - Transaction parameters
   * @param params.coin - The coin to send (AccountCoin with chain, address, decimals, ticker, and optional id for tokens)
   * @param params.receiver - The recipient's address
   * @param params.amount - Amount to send in base units (as bigint)
   * @param params.memo - Optional transaction memo (for chains that support it)
   * @param params.feeSettings - Optional custom fee settings (FeeSettings - chain-specific)
   *
   * @returns A KeysignPayload ready to be signed with the sign() method
   *
   * @example
   * ```typescript
   * // Prepare a native coin transfer
   * const payload = await vault.prepareSendTx({
   *   coin: {
   *     chain: Chain.Ethereum,
   *     address: await vault.address('ethereum'),
   *     decimals: 18,
   *     ticker: 'ETH'
   *   },
   *   receiver: '0x...',
   *   amount: 1500000000000000000n // 1.5 ETH
   * })
   *
   * // Sign the transaction
   * const signature = await vault.sign('fast', payload, password)
   * ```
   *
   * @example
   * ```typescript
   * // Prepare a token transfer with custom fees
   * const payload = await vault.prepareSendTx({
   *   coin: {
   *     chain: Chain.Ethereum,
   *     address: await vault.address('ethereum'),
   *     decimals: 6,
   *     ticker: 'USDC',
   *     id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
   *   },
   *   receiver: '0x...',
   *   amount: 100000000n, // 100 USDC
   *   feeSettings: {
   *     maxPriorityFeePerGas: 2000000000n,
   *     gasLimit: 100000n
   *   }
   * })
   * ```
   */
  async prepareSendTx(params: {
    coin: AccountCoin
    receiver: string
    amount: bigint
    memo?: string
    feeSettings?: FeeSettings
  }): Promise<KeysignPayload> {
    return this.transactionBuilder.prepareSendTx(params)
  }

  /**
   * Extract message hashes from a KeysignPayload
   *
   * This helper method extracts the pre-signing message hashes from a KeysignPayload
   * that was created by prepareSendTx(). These hashes are required for signing.
   *
   * @param keysignPayload - Payload from prepareSendTx()
   * @returns Array of hex-encoded message hashes
   *
   * @example
   * ```typescript
   * const keysignPayload = await vault.prepareSendTx({ ... })
   * const messageHashes = await vault.extractMessageHashes(keysignPayload)
   * const signingPayload = { transaction: keysignPayload, chain, messageHashes }
   * const signature = await vault.sign('fast', signingPayload, password)
   * ```
   */
  async extractMessageHashes(
    keysignPayload: KeysignPayload
  ): Promise<string[]> {
    return this.transactionBuilder.extractMessageHashes(keysignPayload)
  }

  // ===== SIGNING METHODS =====

  /**
   * Sign transaction
   * Password is resolved automatically from cache or onPasswordRequired callback
   */
  async sign(mode: SigningMode, payload: SigningPayload): Promise<Signature> {
    this.validateSigningMode(mode)

    switch (mode) {
      case 'fast':
        return this.signFast(payload)
      case 'relay':
        throw new VaultError(
          VaultErrorCode.NotImplemented,
          'Relay signing not implemented yet'
        )
      case 'local':
        throw new VaultError(
          VaultErrorCode.NotImplemented,
          'Local signing not implemented yet'
        )
      default:
        throw new VaultError(
          VaultErrorCode.InvalidConfig,
          `Unsupported signing mode: ${mode}`
        )
    }
  }

  /**
   * Validate signing mode against vault type
   */
  private validateSigningMode(mode: SigningMode): void {
    const securityType = this.vaultData.type

    if (mode === 'fast' && securityType !== 'fast') {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'Fast signing is only available for fast vaults (vaults with VultiServer)'
      )
    }

    if (mode === 'relay' && securityType !== 'secure') {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'Relay signing is only available for secure vaults'
      )
    }
  }

  /**
   * Check if this vault is encrypted and requires a password
   * Uses VaultData.isEncrypted as the source of truth
   */
  private isVaultEncrypted(): boolean {
    return this.vaultData.isEncrypted
  }

  /**
   * Resolve password from cache or prompt callback
   * Returns undefined for unencrypted vaults
   */
  private async resolvePassword(): Promise<string | undefined> {
    // If vault is not encrypted, no password needed
    if (!this.isVaultEncrypted()) {
      return undefined
    }

    // For encrypted vaults, check cache first
    const cachedPassword = this.passwordCache.get(this.id.toString())
    if (cachedPassword) {
      return cachedPassword
    }

    // Try callback
    if (this.config?.onPasswordRequired) {
      try {
        const password = await this.config.onPasswordRequired(
          this.id.toString(),
          this.name
        )
        // Cache for future use
        this.passwordCache.set(this.id.toString(), password)
        return password
      } catch (error) {
        throw new VaultError(
          VaultErrorCode.InvalidConfig,
          `Failed to get password for vault "${this.name}": ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    // No password available for ENCRYPTED vault
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      `Password required for encrypted vault "${this.name}" but not cached. ` +
        `Please unlock vault with unlock() method or configure onPasswordRequired callback.`
    )
  }

  /**
   * Ensure keyShares are loaded from vault file (lazy loading with password)
   * This is called before signing operations that need keyShares
   */
  private async ensureKeySharesLoaded(): Promise<void> {
    // Check if keyShares are already loaded
    if (
      this.coreVault.keyShares.ecdsa &&
      this.coreVault.keyShares.ecdsa.length > 0 &&
      this.coreVault.keyShares.eddsa &&
      this.coreVault.keyShares.eddsa.length > 0
    ) {
      return // Already loaded
    }

    // Check if vault file content is available
    if (
      !this.vaultData.vultFileContent ||
      this.vaultData.vultFileContent.trim().length === 0
    ) {
      return
    }

    // Parse vault file to get keyShares
    const container = vaultContainerFromString(
      this.vaultData.vultFileContent.trim()
    )

    // Handle decryption if needed
    let vaultBase64: string
    if (container.isEncrypted) {
      // Resolve password from cache or callback
      const decryptionPassword = await this.resolvePassword()
      if (!decryptionPassword) {
        throw new VaultError(
          VaultErrorCode.InvalidConfig,
          'Password required for encrypted vault'
        )
      }
      const encryptedData = fromBase64(container.vault)
      const decryptedBuffer = await decryptWithAesGcm({
        key: decryptionPassword,
        value: encryptedData,
      })
      vaultBase64 = Buffer.from(decryptedBuffer).toString('base64')
    } else {
      // Unencrypted vault - no password needed
      vaultBase64 = container.vault
    }

    // Parse inner Vault protobuf
    const vaultBinary = fromBase64(vaultBase64)
    const vaultProtobuf = fromBinary(VaultSchema, vaultBinary)
    const parsedVault = fromCommVault(vaultProtobuf)

    // Update CoreVault with keyShares
    this.coreVault.keyShares = parsedVault.keyShares
  }

  /**
   * Fast signing with VultiServer
   *
   * NOTE: Fast vaults are ALWAYS encrypted and require a password.
   * They use 2-of-2 MPC with VultiServer and are created with password protection.
   */
  private async signFast(payload: SigningPayload): Promise<Signature> {
    if (!this.fastSigningService) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'FastSigningService not initialized'
      )
    }

    try {
      // Ensure keyShares are loaded from vault file (lazy loading)
      await this.ensureKeySharesLoaded()

      // Fast vaults are always encrypted - resolve password
      // resolvePassword() will throw if password not available
      const password = await this.resolvePassword()

      if (!password) {
        // This should never happen for fast vaults, but check for safety
        throw new VaultError(
          VaultErrorCode.InvalidConfig,
          'Password is required for fast signing. Fast vaults are always encrypted.'
        )
      }

      const signature = await this.fastSigningService.signWithServer(
        this.coreVault,
        payload,
        password,
        step => {
          // Emit progress on THIS vault instance
          this.emit('signingProgress', { step })
        }
      )

      // Emit transaction signed event (serves as completion event)
      this.emit('transactionSigned', { signature, payload })

      return signature
    } catch (error) {
      this.emit('error', error as Error)

      if (error instanceof VaultError) {
        throw error
      }

      throw new VaultError(
        VaultErrorCode.SigningFailed,
        `Fast signing failed: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  // ===== TRANSACTION BROADCASTING =====

  /**
   * Broadcast a signed transaction to the blockchain network
   *
   * This method compiles the signed transaction and broadcasts it to the network.
   * It should be called after prepareSendTx() and sign().
   *
   * @param params - Broadcast parameters
   * @param params.chain - The blockchain to broadcast on
   * @param params.keysignPayload - Original payload from prepareSendTx()
   * @param params.signature - Signature from sign()
   *
   * @returns Transaction hash (string) on success
   *
   * @throws {VaultError} With code BroadcastFailed if broadcast fails
   *
   * @fires VaultEvents#transactionBroadcast - When broadcast succeeds
   *
   * @example
   * ```typescript
   * // Complete transaction flow
   * const payload = await vault.prepareSendTx({
   *   coin: { chain: Chain.Ethereum, address, decimals: 18, ticker: 'ETH' },
   *   receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
   *   amount: 1000000000000000000n
   * })
   *
   * const messageHashes = await vault.extractMessageHashes(payload)
   * const signature = await vault.sign('fast', {
   *   transaction: payload,
   *   chain: Chain.Ethereum,
   *   messageHashes
   * }, password)
   *
   * const txHash = await vault.broadcastTx({
   *   chain: Chain.Ethereum,
   *   keysignPayload: payload,
   *   signature
   * })
   *
   * console.log(`Transaction: ${txHash}`)
   * // Output: "Transaction: 0x1234567890abcdef..."
   * ```
   */
  async broadcastTx(params: {
    chain: Chain
    keysignPayload: KeysignPayload
    signature: Signature
  }): Promise<string> {
    const { chain, keysignPayload, signature } = params

    try {
      // Delegate to BroadcastService
      const txHash = await this.broadcastService.broadcastTx({
        chain,
        keysignPayload,
        signature,
      })

      // Emit success event
      this.emit('transactionBroadcast', {
        chain,
        txHash,
        keysignPayload,
      })

      return txHash
    } catch (error) {
      // BroadcastService already wraps errors in VaultError
      this.emit('error', error as Error)
      throw error
    }
  }

  // ===== TOKEN MANAGEMENT =====

  /**
   * Set tokens for a chain
   */
  async setTokens(chain: Chain, tokens: Token[]): Promise<void> {
    return this.balanceService.setTokens(chain, tokens)
  }

  /**
   * Add single token to chain
   */
  async addToken(chain: Chain, token: Token): Promise<void> {
    return this.balanceService.addToken(chain, token)
  }

  /**
   * Remove token from chain
   */
  async removeToken(chain: Chain, tokenId: string): Promise<void> {
    return this.balanceService.removeToken(chain, tokenId)
  }

  /**
   * Get tokens for chain
   */
  getTokens(chain: Chain): Token[] {
    return this._tokens[chain] || []
  }

  // ===== CHAIN MANAGEMENT =====

  /**
   * Set user chains
   */
  async setChains(chains: Chain[]): Promise<void> {
    return this.preferencesService.setChains(chains)
  }

  /**
   * Add single chain
   */
  async addChain(chain: Chain): Promise<void> {
    return this.preferencesService.addChain(chain)
  }

  /**
   * Remove single chain
   */
  async removeChain(chain: Chain): Promise<void> {
    return this.preferencesService.removeChain(chain)
  }

  /**
   * Get current user chains
   */
  getChains(): Chain[] {
    return this.preferencesService.getChains()
  }

  /**
   * Reset to default chains
   */
  async resetToDefaultChains(): Promise<void> {
    return this.preferencesService.resetToDefaultChains()
  }

  /**
   * Get supported chains (alias for getChains)
   */
  private getSupportedChains(): Chain[] {
    return this.getChains()
  }

  // ===== CURRENCY MANAGEMENT =====

  /**
   * Set vault currency
   */
  async setCurrency(currency: string): Promise<void> {
    return this.preferencesService.setCurrency(currency)
  }

  /**
   * Get vault currency
   */
  getCurrency(): string {
    return this.preferencesService.getCurrencyPreference()
  }

  // ===== FIAT VALUE OPERATIONS =====

  /**
   * Get fiat value for a specific asset
   * Combines balance and price data to calculate current value
   *
   * @param chain Chain to get value for
   * @param tokenId Optional token contract address (omit for native token)
   * @param fiatCurrency Optional currency override (defaults to vault currency)
   * @returns Current value in specified fiat currency
   *
   * @example
   * ```typescript
   * // Get ETH value in vault's currency
   * const ethValue = await vault.getValue(Chain.Ethereum)
   * console.log(`ETH value: ${ethValue.currency} ${ethValue.amount}`)
   *
   * // Get USDC value in EUR
   * const usdcValue = await vault.getValue(
   *   Chain.Ethereum,
   *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
   *   'eur'
   * )
   * ```
   */
  async getValue(
    chain: Chain,
    tokenId?: string,
    fiatCurrency?: FiatCurrency
  ): Promise<Value> {
    const value = await this.fiatValueService.getValue(
      chain,
      tokenId,
      fiatCurrency
    )
    return value
  }

  /**
   * Get fiat values for all assets on a chain (native + tokens)
   *
   * @param chain Chain to get values for
   * @param fiatCurrency Optional currency override
   * @returns Record of asset ID to Value
   *
   * @example
   * ```typescript
   * const values = await vault.getValues(Chain.Ethereum)
   * console.log('Native ETH:', values.native.amount)
   * console.log('USDC:', values['0xA0b86991...'].amount)
   * ```
   */
  async getValues(
    chain: Chain,
    fiatCurrency?: FiatCurrency
  ): Promise<Record<string, Value>> {
    return this.fiatValueService.getValues(chain, fiatCurrency)
  }

  /**
   * Refresh price data for specified chain or all chains
   * Clears price cache to force fresh fetch
   *
   * @param chain Chain to update ('all' for all chains)
   *
   * @example
   * ```typescript
   * // Update prices for Ethereum
   * await vault.updateValues(Chain.Ethereum)
   *
   * // Update prices for all chains
   * await vault.updateValues('all')
   * ```
   */
  async updateValues(chain: Chain | 'all'): Promise<void> {
    await this.fiatValueService.updateValues(chain)
    // Emit event
    this.emit('valuesUpdated', { chain })
  }

  /**
   * Get total portfolio value across all chains and tokens
   * Uses 1-minute cache to avoid excessive calculations
   *
   * @param fiatCurrency Optional currency override
   * @returns Total portfolio value
   *
   * @example
   * ```typescript
   * const total = await vault.getTotalValue()
   * console.log(`Total portfolio: ${total.currency} ${total.amount}`)
   * ```
   */
  async getTotalValue(fiatCurrency?: FiatCurrency): Promise<Value> {
    return this.fiatValueService.getTotalValue(fiatCurrency)
  }

  /**
   * Force recalculation of total portfolio value (invalidates cache)
   *
   * @param fiatCurrency Optional currency override
   * @returns Updated total portfolio value
   *
   * @example
   * ```typescript
   * // Force fresh calculation
   * const total = await vault.updateTotalValue()
   * console.log(`Updated total: ${total.currency} ${total.amount}`)
   * ```
   */
  async updateTotalValue(fiatCurrency?: FiatCurrency): Promise<Value> {
    const totalValue =
      await this.fiatValueService.updateTotalValue(fiatCurrency)
    // Emit event
    this.emit('totalValueUpdated', { value: totalValue })
    return totalValue
  }

  // ===== DATA ACCESS =====
}
