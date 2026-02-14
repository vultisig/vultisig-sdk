// Core functions (functional dispatch) - Direct imports from core
import { fromBinary } from '@bufbuild/protobuf'
import { banxaSupportedChains, getBanxaBuyUrl } from '@core/chain/banxa'
import { Chain } from '@core/chain/Chain'
import { AccountCoin } from '@core/chain/coin/AccountCoin'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { vaultConfig } from '@core/config'
import { FeeSettings } from '@core/mpc/keysign/chainSpecific/FeeSettings'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { fromBase64 } from '@lib/utils/fromBase64'

import { DEFAULT_CHAINS } from '../constants'
// SDK utilities
import type { VaultContext } from '../context/SdkContext'
import { UniversalEventEmitter } from '../events/EventEmitter'
import type { VaultEvents } from '../events/types'
import { CacheScope, CacheService } from '../services/CacheService'
import { DiscountTierService } from '../services/DiscountTierService'
import { FiatValueService } from '../services/FiatValueService'
import type { PasswordCacheService } from '../services/PasswordCacheService'
import type { Storage } from '../storage/types'
// Types
import {
  Balance,
  CosmosSigningOptions,
  FiatCurrency,
  GasInfoForChain,
  SignAminoInput,
  Signature,
  SignBytesOptions,
  SignDirectInput,
  SigningMode,
  SigningPayload,
  Token,
  Value,
  VaultData,
} from '../types'
import type { TransactionSimulationResult, TransactionValidationResult } from '../types/security'
import type { DiscoveredToken, TokenInfo } from '../types/tokens'
import { createVaultBackup } from '../utils/export'
// Vault services
import { AddressService } from './services/AddressService'
import { BalanceService } from './services/BalanceService'
import { BroadcastService } from './services/BroadcastService'
import { GasEstimationService } from './services/GasEstimationService'
import { PreferencesService } from './services/PreferencesService'
import { RawBroadcastService } from './services/RawBroadcastService'
import { SecurityService } from './services/SecurityService'
import { SwapService } from './services/SwapService'
import { TokenDiscoveryService } from './services/TokenDiscoveryService'
import { TransactionBuilder } from './services/TransactionBuilder'
// Swap types
import type { SwapPrepareResult, SwapQuoteParams, SwapQuoteResult, SwapTxParams } from './swap-types'
import { VaultError, VaultErrorCode } from './VaultError'
import { VaultConfig } from './VaultServices'

/**
 * Determine vault type based on signer names
 * Fast vaults have one signer that starts with "Server-"
 * Secure vaults have only device signers (no "Server-" prefix)
 */
function determineVaultType(signers: string[]): 'fast' | 'secure' {
  return signers.some(signer => signer.startsWith('Server-')) ? 'fast' : 'secure'
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
  protected rawBroadcastService: RawBroadcastService
  protected preferencesService: PreferencesService
  protected swapService: SwapService
  protected discountTierService: DiscountTierService
  protected tokenDiscoveryService: TokenDiscoveryService
  protected securityService: SecurityService

  // Runtime state (persisted via storage)
  protected _userChains: Chain[] = []
  protected _currency: string = 'usd'
  protected _tokens: Record<string, Token[]> = {}

  // Storage for persistence (required)
  protected storage: Storage

  // WASM provider for wallet operations
  protected wasmProvider: VaultContext['wasmProvider']

  // Vault configuration for password callback
  protected config?: VaultConfig

  // Vault data and core vault
  protected vaultData: VaultData // Single source of truth
  protected coreVault: CoreVault // Built from vaultData

  /**
   * Protected constructor - use subclass factory methods instead.
   * @internal
   */
  protected constructor(
    vaultId: string,
    name: string,
    vultFileContent: string,
    context: VaultContext,
    parsedVaultData?: CoreVault
  ) {
    // Initialize EventEmitter
    super()

    // Use context-provided dependencies
    this.storage = context.storage
    this.passwordCache = context.passwordCache
    this.wasmProvider = context.wasmProvider

    // Build VaultConfig from context
    this.config = {
      defaultChains: context.config.defaultChains,
      defaultCurrency: context.config.defaultCurrency,
      cacheConfig: context.config.cacheConfig,
      passwordCache: context.config.passwordCache,
      onPasswordRequired: context.config.onPasswordRequired,
    }

    // Initialize cache service with storage from context
    this.cacheService = new CacheService(this.storage, vaultId, this.config.cacheConfig)

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
          throw new Error('Cannot parse encrypted vault synchronously. Use parsedVaultData parameter.')
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
      keyShares:
        parsedVaultData?.keyShares?.ecdsa && parsedVaultData?.keyShares?.eddsa
          ? parsedVaultData.keyShares
          : { ecdsa: '', eddsa: '' }, // Lazy-loaded from vaultFileContent if not provided
      folderId: parsedVault.folderId,
      chainPublicKeys: parsedVault.chainPublicKeys,
      chainKeyShares: parsedVault.chainKeyShares,
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

      // Chain-specific keys (for seedphrase imports)
      chainPublicKeys: this.coreVault.chainPublicKeys,
      chainKeyShares: this.coreVault.chainKeyShares,

      // User Preferences
      currency: this.config?.defaultCurrency?.toLowerCase() || 'usd',
      chains: this.config?.defaultChains?.map(c => c.toString()) || [],
      tokens: {},

      // Vault file
      vultFileContent: vultFileContent.trim(),
    }

    // Initialize runtime state
    this._userChains =
      this.vaultData.chains.length > 0
        ? this.vaultData.chains.map(c => c as Chain)
        : (this.config?.defaultChains ?? DEFAULT_CHAINS)
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

    // Initialize extracted services (pass wasmProvider to those that need WASM)
    this.addressService = new AddressService(this.coreVault, this.cacheService, this.wasmProvider)
    this.transactionBuilder = new TransactionBuilder(this.coreVault, this.wasmProvider)
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
      chain => this.address(chain),
      this.wasmProvider
    )
    this.broadcastService = new BroadcastService(
      keysignPayload => this.extractMessageHashes(keysignPayload),
      this.wasmProvider
    )
    this.rawBroadcastService = new RawBroadcastService()
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
    this.discountTierService = new DiscountTierService(this.cacheService, () => this.address(Chain.Ethereum))
    this.swapService = new SwapService(
      this.coreVault,
      chain => this.address(chain),
      (event, data) => this.emit(event, data),
      this.wasmProvider,
      this.fiatValueService,
      this.discountTierService
    )
    this.tokenDiscoveryService = new TokenDiscoveryService(chain => this.address(chain))
    this.securityService = new SecurityService(this.wasmProvider)

    // Setup event-driven cache invalidation
    this.setupCacheInvalidation()
  }

  // ===== ABSTRACT METHODS (MUST BE IMPLEMENTED BY SUBCLASSES) =====

  /**
   * Sign a transaction using the vault's signing mode(s)
   * Implementation differs between fast and secure vaults
   *
   * @param payload - Transaction payload to sign
   * @param options - Optional parameters including abort signal
   */
  abstract sign(payload: SigningPayload, options?: { signal?: AbortSignal }): Promise<Signature>

  /**
   * Sign arbitrary pre-hashed bytes
   *
   * This method is for advanced use cases where you need to sign raw bytes
   * without a chain-specific transaction context. The input data should already
   * be hashed (e.g., a 32-byte hash for ECDSA, 64-byte message for EdDSA).
   *
   * The chain parameter determines:
   * - Signature algorithm (ECDSA for EVM/UTXO chains, EdDSA for Solana/Sui)
   * - Derivation path (chain-specific BIP-44 path)
   *
   * Implementation differs between fast and secure vaults.
   *
   * @param options - Signing options (data and chain)
   * @param signingOptions - Optional parameters including abort signal
   * @returns Signature from vault coordination
   */
  abstract signBytes(options: SignBytesOptions, signingOptions?: { signal?: AbortSignal }): Promise<Signature>

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

  // ===== PRIVATE METHODS =====

  /**
   * Setup event-driven cache invalidation
   * Automatically invalidates relevant caches when vault state changes
   */
  private setupCacheInvalidation(): void {
    // When tokens are added/removed, invalidate balances for that chain
    this.on('tokenAdded', async ({ chain }) => {
      await this.cacheService.invalidateByPrefix(`${CacheScope.BALANCE}:${chain.toLowerCase()}`)
    })

    this.on('tokenRemoved', async ({ chain }) => {
      await this.cacheService.invalidateByPrefix(`${CacheScope.BALANCE}:${chain.toLowerCase()}`)
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

    if (name.length > vaultConfig.maxNameLength) {
      errors.push(`Vault name cannot exceed ${vaultConfig.maxNameLength} characters`)
    }

    if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
      errors.push('Vault name can only contain letters, numbers, spaces, hyphens, and underscores')
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
    const cached = this.passwordCache.get(this.id)
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
      password = await this.config.onPasswordRequired(this.id, this.name)
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Failed to get password for vault "${this.name}": ${error instanceof Error ? error.message : String(error)}`
      )
    }

    if (!password) {
      throw new VaultError(VaultErrorCode.InvalidConfig, 'Password required but callback returned empty value')
    }

    // Cache for future use
    this.passwordCache.set(this.id, password)

    return password
  }

  // ===== PUBLIC GETTERS =====

  /** Unique vault identifier (ECDSA public key). */
  get id(): string {
    return this.vaultData.id
  }

  /** Raw vault data object. */
  get data(): VaultData {
    return this.vaultData
  }

  /** Vault display name. */
  get name(): string {
    return this.vaultData.name
  }

  /** Vault public keys for ECDSA and EdDSA signing. */
  get publicKeys(): Readonly<{ ecdsa: string; eddsa: string }> {
    return this.vaultData.publicKeys
  }

  /** Vault chain code in hexadecimal format. */
  get hexChainCode(): string {
    return this.vaultData.hexChainCode
  }

  /** List of signers participating in this vault's MPC. */
  get signers(): Array<{ id: string; publicKey: string; name: string }> {
    return this.vaultData.signers.map((signerId, index) => ({
      id: signerId,
      publicKey: this.vaultData.publicKeys.ecdsa, // All signers share the same public key in TSS
      name: `Signer ${index + 1}`,
    }))
  }

  /** This device's party ID in the MPC protocol. */
  get localPartyId(): string {
    return this.vaultData.localPartyId
  }

  /** Vault creation timestamp (Unix milliseconds). */
  get createdAt(): number {
    return this.vaultData.createdAt
  }

  /** MPC library type (GG20 or DKLS). */
  get libType(): string {
    return this.vaultData.libType
  }

  /** Whether the vault is password-protected. */
  get isEncrypted(): boolean {
    return this.vaultData.isEncrypted
  }

  /** Vault type: 'fast' (2-of-2 with server) or 'secure' (multi-device). */
  get type(): 'fast' | 'secure' {
    return this.vaultData.type
  }

  /** Whether the vault has been backed up. */
  get isBackedUp(): boolean {
    return this.vaultData.isBackedUp
  }

  /** Vault display order. */
  get order(): number {
    return this.vaultData.order
  }

  /** Folder ID if vault is organized in a folder. */
  get folderId(): string | undefined {
    return this.vaultData.folderId
  }

  /** Last modification timestamp (Unix milliseconds). */
  get lastModified(): number {
    return this.vaultData.lastModified
  }

  /** Total number of signers in this vault. */
  get totalSigners(): number {
    return this.vaultData.signers.length
  }

  /** Vault's preferred fiat currency (e.g., 'usd', 'eur'). */
  get currency(): string {
    return this._currency
  }

  /** Custom tokens added to this vault, grouped by chain. */
  get tokens(): Record<string, Token[]> {
    return this._tokens
  }

  /** Active blockchain chains for this vault. */
  get chains(): Chain[] {
    return this._userChains
  }

  /** Vault cryptographic keys. */
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
    const loadedVaultData = await this.storage.get<VaultData>(`vault:${this.vaultData.id}`)
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
      throw new VaultError(VaultErrorCode.InvalidConfig, validationResult.errors?.[0] || 'Invalid vault name')
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
    // Ensure keyShares are loaded from vault file before exporting
    // This is critical: keyShares are lazy-loaded and will be empty if not loaded
    await this.ensureKeySharesLoaded()

    const totalSigners = this.vaultData.signers.length
    const localPartyIndex = this.vaultData.signers.indexOf(this.vaultData.localPartyId) + 1

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

    // Remove all cache entries for this vault
    const allKeys = await this.storage.list()
    const cacheKeys = allKeys.filter(k => k.startsWith(`cache:${this.vaultData.id}:`))
    await Promise.all(cacheKeys.map(key => this.storage.remove(key)))

    // Emit deleted event
    this.emit('deleted', { vaultId: this.vaultData.id })
  }

  /**
   * Reload vault data from storage
   */
  async load(): Promise<void> {
    const loadedVaultData = await this.storage.get<VaultData>(`vault:${this.vaultData.id}`)

    if (!loadedVaultData) {
      throw new VaultError(VaultErrorCode.InvalidVault, `Vault ${this.vaultData.id} not found in storage`)
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
    const vaultData = await this.storage.get<VaultData>(`vault:${this.vaultData.id}`)
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
    this.passwordCache.delete(this.id)
    // Clear keyShares from memory
    this.coreVault.keyShares = { ecdsa: '', eddsa: '' }
  }

  /**
   * Unlock this vault by caching password
   */
  public async unlock(password: string): Promise<void> {
    if (!this.isVaultEncrypted()) {
      throw new VaultError(VaultErrorCode.InvalidConfig, 'Cannot unlock unencrypted vault')
    }

    // Temporarily cache password for verification
    this.passwordCache.set(this.id, password)

    try {
      // Verify password by attempting to load key shares
      await this.ensureKeySharesLoaded()
      // Password is valid and now cached
    } catch (error) {
      // Password is invalid - remove from cache
      this.passwordCache.delete(this.id)
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
    return (!!this.coreVault.keyShares.ecdsa && !!this.coreVault.keyShares.eddsa) || this.passwordCache.has(this.id)
  }

  /**
   * Get remaining time before password cache expires
   */
  public getUnlockTimeRemaining(): number | undefined {
    if (!this.isVaultEncrypted()) {
      return undefined // Unencrypted vaults don't have unlock time
    }
    return this.passwordCache.getRemainingTTL(this.id)
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
  async balances(chains?: Chain[], includeTokens = false): Promise<Record<string, Balance>> {
    const chainsToFetch = chains || this._userChains
    return this.balanceService.getBalances({ chains: chainsToFetch, includeTokens })
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
  async updateBalances(chains?: Chain[], includeTokens = false): Promise<Record<string, Balance>> {
    const chainsToUpdate = chains || this._userChains
    return this.balanceService.updateBalances({ chains: chainsToUpdate, includeTokens })
  }

  // ===== GAS ESTIMATION =====

  /**
   * Get gas info for chain
   */
  async gas<C extends Chain>(chain: C): Promise<GasInfoForChain<C>> {
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
  async extractMessageHashes(keysignPayload: KeysignPayload): Promise<string[]> {
    return this.transactionBuilder.extractMessageHashes(keysignPayload)
  }

  /**
   * Prepare a SignAmino keysign payload for custom Cosmos messages
   *
   * SignAmino uses the legacy Amino (JSON) signing format, which is widely
   * supported across Cosmos SDK chains. Use this for governance votes,
   * staking operations, IBC transfers, and other custom messages.
   *
   * @param input - SignAmino transaction parameters
   * @param options - Optional signing options
   * @returns A KeysignPayload ready to be signed with the sign() method
   *
   * @example
   * ```typescript
   * const payload = await vault.prepareSignAminoTx({
   *   chain: Chain.Cosmos,
   *   coin: {
   *     chain: Chain.Cosmos,
   *     address: await vault.address(Chain.Cosmos),
   *     decimals: 6,
   *     ticker: 'ATOM',
   *   },
   *   msgs: [{
   *     type: 'cosmos-sdk/MsgVote',
   *     value: JSON.stringify({
   *       proposal_id: '123',
   *       voter: cosmosAddress,
   *       option: 'VOTE_OPTION_YES',
   *     }),
   *   }],
   *   fee: {
   *     amount: [{ denom: 'uatom', amount: '5000' }],
   *     gas: '200000',
   *   },
   * })
   * ```
   */
  async prepareSignAminoTx(input: SignAminoInput, options?: CosmosSigningOptions): Promise<KeysignPayload> {
    return this.transactionBuilder.prepareSignAminoTx(input, options)
  }

  /**
   * Prepare a SignDirect keysign payload for custom Cosmos messages
   *
   * SignDirect uses the modern Protobuf signing format, which is more
   * efficient and type-safe. Use this when you have pre-encoded transaction
   * bytes or need exact control over the transaction structure.
   *
   * @param input - SignDirect transaction parameters
   * @param options - Optional signing options
   * @returns A KeysignPayload ready to be signed with the sign() method
   *
   * @example
   * ```typescript
   * const payload = await vault.prepareSignDirectTx({
   *   chain: Chain.Cosmos,
   *   coin: {
   *     chain: Chain.Cosmos,
   *     address: await vault.address(Chain.Cosmos),
   *     decimals: 6,
   *     ticker: 'ATOM',
   *   },
   *   bodyBytes: encodedTxBodyBase64,
   *   authInfoBytes: encodedAuthInfoBase64,
   *   chainId: 'cosmoshub-4',
   *   accountNumber: '12345',
   * })
   * ```
   */
  async prepareSignDirectTx(input: SignDirectInput, options?: CosmosSigningOptions): Promise<KeysignPayload> {
    return this.transactionBuilder.prepareSignDirectTx(input, options)
  }

  // ===== TRANSACTION BROADCASTING =====

  /**
   * Broadcast a signed transaction to the blockchain network
   */
  async broadcastTx(params: { chain: Chain; keysignPayload: KeysignPayload; signature: Signature }): Promise<string> {
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

  /**
   * Broadcast a pre-signed raw transaction to the blockchain network
   *
   * This method is for advanced use cases where you construct and sign
   * transactions externally (e.g., with ethers.js or bitcoinjs-lib) and
   * just need to broadcast the final signed transaction bytes.
   *
   * @param params - Broadcast parameters
   * @param params.chain - Target blockchain
   * @param params.rawTx - Hex-encoded signed transaction (with or without 0x prefix)
   *
   * @returns Transaction hash on success
   *
   * @throws {VaultError} With code BroadcastFailed if broadcast fails
   * @throws {VaultError} With code UnsupportedChain if chain is not yet supported
   *
   * @example
   * ```typescript
   * // Build and sign transaction with ethers.js
   * const signedTx = await ethersWallet.signTransaction(tx)
   *
   * // Broadcast via SDK
   * const txHash = await vault.broadcastRawTx({
   *   chain: Chain.Ethereum,
   *   rawTx: signedTx,
   * })
   * console.log(`Transaction: ${txHash}`)
   * ```
   */
  async broadcastRawTx(params: { chain: Chain; rawTx: string }): Promise<string> {
    const { chain, rawTx } = params

    try {
      const txHash = await this.rawBroadcastService.broadcastRawTx({ chain, rawTx })

      // Emit success event
      this.emit('transactionBroadcast', {
        chain,
        txHash,
        raw: true,
      })

      return txHash
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  // ===== SWAP OPERATIONS =====

  /**
   * Get a swap quote for exchanging tokens
   *
   * Fetches quotes from the best available provider (1inch, KyberSwap, LiFi,
   * THORChain, or MayaChain) based on the token pair and chains.
   *
   * @param params - Swap quote parameters
   * @param params.fromCoin - Source coin (AccountCoin or SimpleCoinInput)
   * @param params.toCoin - Destination coin
   * @param params.amount - Amount to swap (human-readable, e.g., 1.5 for 1.5 ETH)
   * @param params.referral - Optional referral address for affiliate fees
   * @param params.affiliateBps - Affiliate fee in basis points (e.g., 50 = 0.5%)
   *
   * @returns SwapQuoteResult with estimated output, provider, and approval status
   *
   * @example
   * ```typescript
   * const quote = await vault.getSwapQuote({
   *   fromCoin: { chain: Chain.Ethereum, address, decimals: 18, ticker: 'ETH' },
   *   toCoin: { chain: Chain.Ethereum, address, decimals: 6, ticker: 'USDC', id: '0xa0b...' },
   *   amount: 1.5,
   * });
   * console.log(`You'll receive ~${quote.estimatedOutput} USDC via ${quote.provider}`);
   * ```
   */
  async getSwapQuote(params: SwapQuoteParams): Promise<SwapQuoteResult> {
    return this.swapService.getQuote(params)
  }

  /**
   * Prepare a swap transaction for signing
   *
   * Builds a KeysignPayload ready to be signed. If the source token is an ERC-20
   * and approval is needed, the payload will include approval information.
   *
   * @param params - Swap transaction parameters
   * @param params.fromCoin - Source coin
   * @param params.toCoin - Destination coin
   * @param params.amount - Amount to swap
   * @param params.swapQuote - Quote from getSwapQuote()
   * @param params.autoApprove - If true, approval is handled internally (default: false)
   *
   * @returns SwapPrepareResult with keysignPayload and optional approvalPayload
   *
   * @example
   * ```typescript
   * const { keysignPayload, approvalPayload } = await vault.prepareSwapTx({
   *   fromCoin,
   *   toCoin,
   *   amount: 1.5,
   *   swapQuote: quote,
   * });
   *
   * // Handle approval if needed
   * if (approvalPayload) {
   *   const sig = await vault.sign({ transaction: approvalPayload, chain });
   *   await vault.broadcastTx({ chain, keysignPayload: approvalPayload, signature: sig });
   * }
   *
   * // Sign and broadcast swap
   * const signature = await vault.sign({ transaction: keysignPayload, chain });
   * const txHash = await vault.broadcastTx({ chain, keysignPayload, signature });
   * ```
   */
  async prepareSwapTx(params: SwapTxParams): Promise<SwapPrepareResult> {
    return this.swapService.prepareSwapTx(params)
  }

  /**
   * Check if swap is supported between two chains
   *
   * @param fromChain - Source chain
   * @param toChain - Destination chain
   * @returns true if swapping is supported between these chains
   */
  isSwapSupported(fromChain: Chain, toChain: Chain): boolean {
    return this.swapService.isSwapSupported(fromChain, toChain)
  }

  /**
   * Get list of chains that support swapping
   *
   * @returns Array of chains that can be used for swaps
   */
  getSupportedSwapChains(): readonly Chain[] {
    return this.swapService.getSupportedChains()
  }

  /**
   * Get ERC-20 token allowance for a spender
   *
   * @param coin - The token to check allowance for
   * @param spender - The spender address (usually DEX router)
   * @returns Current allowance amount
   */
  async getTokenAllowance(coin: AccountCoin, spender: string): Promise<bigint> {
    return this.swapService.getAllowance(coin, spender)
  }

  /**
   * Get the user's current VULT discount tier based on token holdings
   *
   * The discount tier is determined by the user's VULT token balance and
   * Thorguard NFT ownership on Ethereum. Higher tiers get lower swap fees.
   *
   * @returns Discount tier ('bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'ultimate') or null
   *
   * @example
   * ```typescript
   * const tier = await vault.getDiscountTier()
   * if (tier) {
   *   console.log(`You have ${tier} tier - reduced swap fees!`)
   * }
   * ```
   */
  async getDiscountTier(): Promise<string | null> {
    return this.discountTierService.getDiscountTier()
  }

  /**
   * Force refresh the discount tier (after acquiring more VULT)
   *
   * Call this after the user acquires more VULT tokens or a Thorguard NFT
   * to immediately recalculate their discount tier.
   *
   * @returns Updated discount tier or null
   */
  async updateDiscountTier(): Promise<string | null> {
    this.discountTierService.invalidateCache()
    return this.discountTierService.getDiscountTier()
  }

  // ===== TOKEN MANAGEMENT =====

  /**
   * Set tokens for a specific chain.
   * @param chain - The blockchain chain
   * @param tokens - Array of tokens to set
   */
  async setTokens(chain: Chain, tokens: Token[]): Promise<void> {
    return this.balanceService.setTokens(chain, tokens)
  }

  /**
   * Add a single token to a chain.
   * @param chain - The blockchain chain
   * @param token - Token to add
   */
  async addToken(chain: Chain, token: Token): Promise<void> {
    return this.balanceService.addToken(chain, token)
  }

  /**
   * Remove a token from a chain.
   * @param chain - The blockchain chain
   * @param tokenId - Token contract address or identifier
   */
  async removeToken(chain: Chain, tokenId: string): Promise<void> {
    return this.balanceService.removeToken(chain, tokenId)
  }

  /**
   * Get tokens for a specific chain.
   * @param chain - The blockchain chain
   * @returns Array of tokens on the chain
   */
  getTokens(chain: Chain): Token[] {
    return this._tokens[chain] || []
  }

  // ===== CHAIN MANAGEMENT =====

  /**
   * Set the active chains for this vault.
   * @param chains - Array of chains to enable
   */
  async setChains(chains: Chain[]): Promise<void> {
    return this.preferencesService.setChains(chains)
  }

  /**
   * Add a single chain to this vault.
   * @param chain - Chain to add
   */
  async addChain(chain: Chain): Promise<void> {
    return this.preferencesService.addChain(chain)
  }

  /**
   * Remove a chain from this vault.
   * @param chain - Chain to remove
   */
  async removeChain(chain: Chain): Promise<void> {
    return this.preferencesService.removeChain(chain)
  }

  /**
   * Reset chains to SDK default configuration.
   */
  async resetToDefaultChains(): Promise<void> {
    return this.preferencesService.resetToDefaultChains()
  }

  // ===== CURRENCY MANAGEMENT =====

  /**
   * Set the vault's preferred fiat currency.
   * @param currency - Currency code (e.g., 'usd', 'eur')
   */
  async setCurrency(currency: string): Promise<void> {
    return this.preferencesService.setCurrency(currency)
  }

  // ===== FIAT VALUE OPERATIONS =====

  /**
   * Get fiat value for a specific asset.
   * @param chain - The blockchain chain
   * @param tokenId - Optional token identifier (omit for native asset)
   * @param fiatCurrency - Optional currency override (defaults to vault currency)
   * @returns Fiat value information
   */
  async getValue(chain: Chain, tokenId?: string, fiatCurrency?: FiatCurrency): Promise<Value> {
    const value = await this.fiatValueService.getValue(chain, tokenId, fiatCurrency)
    return value
  }

  /**
   * Get fiat values for all assets on a chain (native + tokens).
   * @param chain - The blockchain chain
   * @param fiatCurrency - Optional currency override
   * @returns Map of asset identifiers to fiat values
   */
  async getValues(chain: Chain, fiatCurrency?: FiatCurrency): Promise<Record<string, Value>> {
    return this.fiatValueService.getValues(chain, fiatCurrency)
  }

  /**
   * Refresh price data for specified chain or all chains.
   * @param chain - Chain to update, or 'all' for all chains
   */
  async updateValues(chain: Chain | 'all'): Promise<void> {
    await this.fiatValueService.updateValues(chain)
    // Emit event
    this.emit('valuesUpdated', { chain })
  }

  /**
   * Get total portfolio value across all chains and tokens.
   * @param fiatCurrency - Optional currency override
   * @returns Total portfolio value
   */
  async getTotalValue(fiatCurrency?: FiatCurrency): Promise<Value> {
    return this.fiatValueService.getTotalValue(fiatCurrency)
  }

  /**
   * Force recalculation of total portfolio value (invalidates cache).
   * @param fiatCurrency - Optional currency override
   * @returns Updated total portfolio value
   */
  async updateTotalValue(fiatCurrency?: FiatCurrency): Promise<Value> {
    const totalValue = await this.fiatValueService.updateTotalValue(fiatCurrency)
    // Emit event
    this.emit('totalValueUpdated', { value: totalValue })
    return totalValue
  }

  // ===== FIAT ON-RAMP =====

  /**
   * Generate a Banxa fiat on-ramp URL for buying crypto
   * with funds sent to this vault's address.
   *
   * Returns null if chain is not supported by Banxa.
   *
   * @param chain - The chain to buy on
   * @param ticker - Token ticker (defaults to chain's native coin)
   */
  async getBuyUrl(chain: Chain, ticker?: string): Promise<string | null> {
    if (!banxaSupportedChains.includes(chain as any)) {
      return null
    }
    const address = await this.address(chain)
    const coinTicker = ticker ?? chainFeeCoin[chain].ticker
    return getBanxaBuyUrl({ address, ticker: coinTicker, chain: chain as any })
  }

  // ===== TOKEN DISCOVERY =====

  /**
   * Discover tokens with non-zero balances at this vault's address.
   * Supported: EVM (via 1Inch), Solana (via Jupiter), Cosmos (via RPC).
   *
   * @param chain - The chain to scan for tokens
   * @returns Array of discovered tokens with balance info
   */
  async discoverTokens(chain: Chain): Promise<DiscoveredToken[]> {
    return this.tokenDiscoveryService.discoverTokens(chain)
  }

  /**
   * Resolve token metadata by contract address.
   * Checks known tokens registry first, then resolves from chain APIs.
   * Supported: EVM, Solana, Cosmos, TRON.
   *
   * @param chain - The chain the token is on
   * @param contractAddress - The token's contract address
   * @returns Token metadata (ticker, decimals, logo, priceProviderId)
   */
  async resolveToken(chain: Chain, contractAddress: string): Promise<TokenInfo> {
    return this.tokenDiscoveryService.resolveToken(chain, contractAddress)
  }

  // ===== SECURITY SCANNING =====

  /**
   * Validate a transaction for security risks before signing.
   * Uses Blockaid to detect malicious contracts, phishing, etc.
   *
   * Supported: EVM chains, Solana, Sui, Bitcoin.
   * Returns null for unsupported chains.
   *
   * @param keysignPayload - From prepareSendTx(), prepareSwapTx(), etc.
   * @returns Validation result with risk level, or null if unsupported
   */
  async validateTransaction(keysignPayload: KeysignPayload): Promise<TransactionValidationResult | null> {
    return this.securityService.validateTransaction(keysignPayload)
  }

  /**
   * Simulate a transaction to preview asset changes before signing.
   *
   * Supported: EVM chains, Solana.
   * Returns null for unsupported chains.
   *
   * @param keysignPayload - From prepareSendTx(), prepareSwapTx(), etc.
   * @returns Simulation result, or null if unsupported
   */
  async simulateTransaction(keysignPayload: KeysignPayload): Promise<TransactionSimulationResult | null> {
    return this.securityService.simulateTransaction(keysignPayload)
  }
}
