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
import { fromBase64 } from '@lib/utils/fromBase64'

// SDK utilities
import { DEFAULT_CHAINS } from '../constants'
import { UniversalEventEmitter } from '../events/EventEmitter'
import { VaultEvents } from '../events/types'
import { MemoryStorage } from '../runtime/storage/MemoryStorage'
import type { Storage } from '../runtime/storage/types'
import { CacheScope, CacheService } from '../services/CacheService'
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
 * VaultBase - Abstract base class for all vault types
 *
 * Provides shared functionality for:
 * - Address derivation and caching
 * - Balance fetching and token management
 * - Transaction preparation and broadcasting
 * - Preferences (chains, currency, tokens)
 * - Fiat value calculations and portfolio
 * - Password management and caching
 *
 * Subclasses must implement:
 * - sign() - Signing implementation specific to vault type
 * - availableSigningModes - Modes supported by this vault type
 * - threshold - Signing threshold for this vault type
 * - ensureKeySharesLoaded() - Key loading logic (encryption handling)
 */
export abstract class VaultBase extends UniversalEventEmitter<VaultEvents> {
  // Essential services
  protected cacheService: CacheService
  protected fiatValueService: FiatValueService
  protected passwordCache: PasswordCacheService

  // Extracted services
  protected addressService: AddressService
  protected transactionBuilder: TransactionBuilder
  protected balanceService: BalanceService
  protected gasEstimationService: GasEstimationService
  protected broadcastService: BroadcastService
  protected preferencesService: PreferencesService

  // Runtime state (persisted via storage)
  protected _userChains: Chain[] = []
  protected _currency: string = 'usd'
  protected _tokens: Record<string, Token[]> = {}

  // Storage for persistence (required)
  protected storage: Storage

  // Vault configuration for password callback
  protected config?: VaultConfig

  // Vault data and core vault
  protected vaultData: VaultData // Single source of truth
  protected coreVault: CoreVault // Built from vaultData

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

  // ===== ABSTRACT METHODS (MUST BE IMPLEMENTED BY SUBCLASSES) =====

  /**
   * Sign a transaction using the vault's signing mode(s)
   * Implementation differs between fast and secure vaults
   */
  abstract sign(payload: SigningPayload): Promise<Signature>

  /**
   * Get available signing modes for this vault type
   * - Fast vaults: ['fast']
   * - Secure vaults: ['relay', 'local'] (depending on services)
   */
  abstract get availableSigningModes(): SigningMode[]

  /**
   * Get signing threshold for this vault type
   * - Fast vaults: 2 (2-of-2 MPC)
   * - Secure vaults: (n+1)/2
   */
  abstract get threshold(): number

  /**
   * Ensure keyShares are loaded into memory
   * Implementation differs based on encryption handling:
   * - Fast vaults: Always encrypted, always decrypt
   * - Secure vaults: Check isEncrypted, decrypt if needed
   */
  protected abstract ensureKeySharesLoaded(): Promise<void>

  // ===== STATIC FACTORY METHOD =====

  /**
   * Reconstruct a Vault instance from stored VaultData
   * Used when loading existing vaults from storage
   *
   * NOTE: This is implemented in VaultManager as a factory method
   * that returns the appropriate subclass (FastVault or SecureVault)
   */
  static fromStorage(
    _vaultData: VaultData,
    _services: VaultServices,
    _config?: VaultConfig,
    _storage?: Storage
  ): VaultBase {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      'fromStorage must be called through VaultManager factory'
    )
  }

  // ===== PRIVATE METHODS =====

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
   * Check if this vault is encrypted and requires a password
   * Uses VaultData.isEncrypted as the source of truth
   */
  protected isVaultEncrypted(): boolean {
    return this.vaultData.isEncrypted
  }

  // ===== PROTECTED METHODS (FOR SUBCLASSES) =====

  /**
   * Resolve password from cache or prompt callback
   *
   * IMPORTANT: Always returns a string (not optional).
   * Callers should check `this.vaultData.isEncrypted` before calling
   * if password is conditionally needed.
   *
   * @throws {VaultError} If password required but unavailable
   */
  protected async resolvePassword(): Promise<string> {
    // Check password cache first
    const cached = this.passwordCache.get(this.id.toString())
    if (cached) {
      return cached
    }

    // Request password from user callback
    if (!this.config?.onPasswordRequired) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'Password required but no callback provided. ' +
          'Set VaultConfig.onPasswordRequired to handle password requests.'
      )
    }

    let password: string
    try {
      password = await this.config.onPasswordRequired(
        this.id.toString(),
        this.name
      )
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Failed to get password for vault "${this.name}": ${error instanceof Error ? error.message : String(error)}`
      )
    }

    if (!password) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'Password required but callback returned empty value'
      )
    }

    // Cache for future use
    this.passwordCache.set(this.id.toString(), password)

    return password
  }

  // ===== PUBLIC GETTERS =====

  get id(): number {
    return this.vaultData.id
  }

  get data(): VaultData {
    return this.vaultData
  }

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

  get totalSigners(): number {
    return this.vaultData.signers.length
  }

  get currency(): string {
    return this._currency
  }

  get tokens(): Record<string, Token[]> {
    return this._tokens
  }

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

  // ===== VAULT MANAGEMENT =====

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
   * Export vault backup
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

  /**
   * Delete this vault from storage
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
   */
  async exists(): Promise<boolean> {
    const vaultData = await this.storage.get<VaultData>(
      `vault:${this.vaultData.id}`
    )
    return vaultData !== null && vaultData !== undefined
  }

  // ===== PASSWORD MANAGEMENT =====

  /**
   * Lock this vault by removing password from cache
   */
  public lock(): void {
    if (!this.isVaultEncrypted()) {
      return // Cannot lock unencrypted vault
    }
    this.passwordCache.delete(this.id.toString())
    // Clear keyShares from memory
    this.coreVault.keyShares = { ecdsa: '', eddsa: '' }
  }

  /**
   * Unlock this vault by caching password
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
   * Check if vault is unlocked (password cached or keyShares loaded)
   */
  public isUnlocked(): boolean {
    if (!this.isVaultEncrypted()) {
      return true // Unencrypted vaults are always unlocked
    }
    // Check if keyShares are loaded OR password is cached
    return (
      (!!this.coreVault.keyShares.ecdsa && !!this.coreVault.keyShares.eddsa) ||
      this.passwordCache.has(this.id.toString())
    )
  }

  /**
   * Get remaining time before password cache expires
   */
  public getUnlockTimeRemaining(): number | undefined {
    if (!this.isVaultEncrypted()) {
      return undefined // Unencrypted vaults don't have unlock time
    }
    return this.passwordCache.getRemainingTTL(this.id.toString())
  }

  // ===== ADDRESS METHODS =====

  /**
   * Get address for specified chain
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
   */
  async gas(chain: Chain): Promise<GasInfo> {
    return this.gasEstimationService.getGasInfo(chain)
  }

  // ===== TRANSACTION PREPARATION =====

  /**
   * Prepare a send transaction keysign payload
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
   */
  async extractMessageHashes(
    keysignPayload: KeysignPayload
  ): Promise<string[]> {
    return this.transactionBuilder.extractMessageHashes(keysignPayload)
  }

  // ===== TRANSACTION BROADCASTING =====

  /**
   * Broadcast a signed transaction to the blockchain network
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
   */
  async getValues(
    chain: Chain,
    fiatCurrency?: FiatCurrency
  ): Promise<Record<string, Value>> {
    return this.fiatValueService.getValues(chain, fiatCurrency)
  }

  /**
   * Refresh price data for specified chain or all chains
   */
  async updateValues(chain: Chain | 'all'): Promise<void> {
    await this.fiatValueService.updateValues(chain)
    // Emit event
    this.emit('valuesUpdated', { chain })
  }

  /**
   * Get total portfolio value across all chains and tokens
   */
  async getTotalValue(fiatCurrency?: FiatCurrency): Promise<Value> {
    return this.fiatValueService.getTotalValue(fiatCurrency)
  }

  /**
   * Force recalculation of total portfolio value (invalidates cache)
   */
  async updateTotalValue(fiatCurrency?: FiatCurrency): Promise<Value> {
    const totalValue =
      await this.fiatValueService.updateTotalValue(fiatCurrency)
    // Emit event
    this.emit('totalValueUpdated', { value: totalValue })
    return totalValue
  }
}
