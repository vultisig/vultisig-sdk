// Core functions (functional dispatch) - Direct imports from core
import { Chain } from '@core/chain/Chain'
import { AccountCoin } from '@core/chain/coin/AccountCoin'
import { FeeSettings } from '@core/mpc/keysign/chainSpecific/FeeSettings'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'

// SDK utilities
import { DEFAULT_CHAINS, isChainSupported } from '../ChainManager'
import { UniversalEventEmitter } from '../events/EventEmitter'
import { VaultEvents } from '../events/types'
import type { VaultStorage } from '../runtime/storage/types'
import { CacheService } from '../services/CacheService'
import { FastSigningService } from '../services/FastSigningService'
// Types
import {
  Balance,
  GasInfo,
  Signature,
  SigningMode,
  SigningPayload,
  Token,
} from '../types'
import { WASMManager } from '../wasm/WASMManager'
// Vault services
import { AddressService } from './services/AddressService'
import { BalanceService } from './services/BalanceService'
import { GasEstimationService } from './services/GasEstimationService'
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
  private wasmManager: WASMManager
  private cacheService: CacheService
  private fastSigningService?: FastSigningService

  // Extracted services
  private addressService: AddressService
  private transactionBuilder: TransactionBuilder
  private balanceService: BalanceService
  private gasEstimationService: GasEstimationService

  // Cached properties
  private _isEncrypted?: boolean
  private _securityType?: 'fast' | 'secure'

  // Runtime state (persisted via storage)
  private _userChains: Chain[] = []
  private _currency: string = 'USD'
  private _tokens: Record<string, Token[]> = {}

  // Storage for persistence
  private storage?: VaultStorage

  constructor(
    private vaultData: CoreVault,
    services: VaultServices,
    config?: VaultConfig,
    storage?: VaultStorage
  ) {
    // Initialize EventEmitter
    super()

    // Inject essential services
    this.wasmManager = services.wasmManager
    this.fastSigningService = services.fastSigningService
    this.cacheService = new CacheService()
    this.storage = storage

    // Initialize extracted services
    this.addressService = new AddressService(
      this.vaultData,
      this.wasmManager,
      this.cacheService,
      () => this._userChains
    )
    this.transactionBuilder = new TransactionBuilder(
      this.vaultData,
      this.wasmManager
    )
    this.balanceService = new BalanceService(
      this.cacheService,
      data => this.emit('balanceUpdated', data),
      error => this.emit('error', error),
      chain => this.address(chain),
      chain => this.getTokens(chain),
      () => this._tokens
    )
    this.gasEstimationService = new GasEstimationService(
      this.vaultData,
      this.wasmManager,
      chain => this.address(chain)
    )

    // Initialize user chains from config
    this._userChains = config?.defaultChains ?? DEFAULT_CHAINS

    // Initialize currency from config
    this._currency = config?.defaultCurrency ?? 'USD'
  }

  /**
   * Load preferences from storage
   */
  async loadPreferences(): Promise<void> {
    if (!this.storage) return

    const vaultId = this.vaultData.publicKeys.ecdsa
    const prefs = await this.storage.get<{
      currency: string
      chains: Chain[]
      tokens: Record<string, Token[]>
    }>(`vault:preferences:${vaultId}`)

    if (prefs) {
      this._currency = prefs.currency
      this._userChains = prefs.chains
      this._tokens = prefs.tokens
    }
  }

  /**
   * Save preferences to storage
   * @private
   */
  private async savePreferences(): Promise<void> {
    if (!this.storage) return

    const vaultId = this.vaultData.publicKeys.ecdsa
    await this.storage.set(`vault:preferences:${vaultId}`, {
      currency: this._currency,
      chains: this._userChains,
      tokens: this._tokens,
    })
  }

  // ===== VAULT INFO =====

  /**
   * Get vault summary information
   */
  summary() {
    return {
      id: this.vaultData.publicKeys.ecdsa,
      name: this.vaultData.name,
      type: this._securityType ?? determineVaultType(this.vaultData.signers),
      chains: this.getChains(),
      createdAt: this.vaultData.createdAt,
      isBackedUp: this.vaultData.isBackedUp,
    }
  }

  /**
   * Set cached encryption status (called during import)
   */
  setCachedEncryptionStatus(isEncrypted: boolean): void {
    this._isEncrypted = isEncrypted
  }

  /**
   * Get cached encryption status
   */
  getCachedEncryptionStatus(): boolean | undefined {
    return this._isEncrypted
  }

  /**
   * Set cached security type (called during import)
   */
  setCachedSecurityType(securityType: 'fast' | 'secure'): void {
    this._securityType = securityType
  }

  /**
   * Get cached security type
   */
  getCachedSecurityType(): 'fast' | 'secure' | undefined {
    return this._securityType
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
    this.vaultData.name = newName

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
   * Export vault data as downloadable file
   */
  async export(password?: string): Promise<Blob> {
    const { createVaultBackup, getExportFileName } = await import(
      '../utils/export'
    )

    const base64Data = await createVaultBackup(this.vaultData, password)
    const filename = getExportFileName(this.vaultData)

    const blob = new Blob([base64Data], { type: 'application/octet-stream' })

    // Automatically download if in browser
    if (
      typeof globalThis !== 'undefined' &&
      'window' in globalThis &&
      'document' in globalThis
    ) {
      const { initiateFileDownload } = await import(
        '@lib/utils/file/initiateFileDownload'
      )
      initiateFileDownload({ blob, name: filename })
    }

    return blob
  }

  /**
   * Delete vault (placeholder)
   */
  delete(): Promise<void> {
    throw new Error(
      'delete() not implemented yet - requires storage integration'
    )
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
    return this.addressService.getAddresses(chains)
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
   */
  async sign(
    mode: SigningMode,
    payload: SigningPayload,
    password?: string
  ): Promise<Signature> {
    this.validateSigningMode(mode)

    switch (mode) {
      case 'fast':
        return this.signFast(payload, password)
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
    const securityType =
      this._securityType ?? determineVaultType(this.vaultData.signers)

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
   * Fast signing with VultiServer
   */
  private async signFast(
    payload: SigningPayload,
    password?: string
  ): Promise<Signature> {
    if (!password) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'Password is required for fast signing'
      )
    }

    if (!this.fastSigningService) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'FastSigningService not initialized'
      )
    }

    try {
      const signature = await this.fastSigningService.signWithServer(
        this.vaultData,
        payload,
        password
      )

      // Emit transaction signed event
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

  // ===== TOKEN MANAGEMENT =====

  /**
   * Set tokens for a chain
   */
  async setTokens(chain: Chain, tokens: Token[]): Promise<void> {
    this._tokens[chain] = tokens
    await this.savePreferences()
  }

  /**
   * Add single token to chain
   */
  async addToken(chain: Chain, token: Token): Promise<void> {
    if (!this._tokens[chain]) this._tokens[chain] = []
    if (!this._tokens[chain].find(t => t.id === token.id)) {
      this._tokens[chain].push(token)
      await this.savePreferences()
      // Emit token added event
      this.emit('tokenAdded', { chain, token })
    }
  }

  /**
   * Remove token from chain
   */
  async removeToken(chain: Chain, tokenId: string): Promise<void> {
    if (this._tokens[chain]) {
      const tokenExists = this._tokens[chain].some(t => t.id === tokenId)
      this._tokens[chain] = this._tokens[chain].filter(t => t.id !== tokenId)

      if (tokenExists) {
        await this.savePreferences()
        // Emit token removed event
        this.emit('tokenRemoved', { chain, tokenId })
      }
    }
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
    // Validate all chains
    chains.forEach(chain => {
      if (!isChainSupported(chain)) {
        throw new VaultError(
          VaultErrorCode.ChainNotSupported,
          `Chain not supported: ${chain}`
        )
      }
    })

    this._userChains = chains

    // Pre-derive addresses
    await this.addresses(chains)

    // Save preferences
    await this.savePreferences()
  }

  /**
   * Add single chain
   */
  async addChain(chain: Chain): Promise<void> {
    if (!isChainSupported(chain)) {
      throw new VaultError(
        VaultErrorCode.ChainNotSupported,
        `Chain not supported: ${chain}`
      )
    }

    if (!this._userChains.includes(chain)) {
      this._userChains.push(chain)
      await this.address(chain) // Pre-derive
      await this.savePreferences()

      // Emit chain added event
      this.emit('chainAdded', { chain })
    }
  }

  /**
   * Remove single chain
   */
  async removeChain(chain: Chain): Promise<void> {
    const chainExists = this._userChains.includes(chain)
    this._userChains = this._userChains.filter(c => c !== chain)

    // Clear address cache
    const cacheKey = `address:${chain.toLowerCase()}`
    this.cacheService.clear(cacheKey)

    if (chainExists) {
      await this.savePreferences()
      // Emit chain removed event
      this.emit('chainRemoved', { chain })
    }
  }

  /**
   * Get current user chains
   */
  getChains(): Chain[] {
    return [...this._userChains]
  }

  /**
   * Reset to default chains
   */
  async resetToDefaultChains(): Promise<void> {
    this._userChains = DEFAULT_CHAINS
    await this.addresses(this._userChains)
    await this.savePreferences()
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
    this._currency = currency
    await this.savePreferences()
  }

  /**
   * Get vault currency
   */
  getCurrency(): string {
    return this._currency
  }

  // ===== DATA ACCESS =====

  /**
   * Get the underlying vault data
   */
  get data(): CoreVault {
    return this.vaultData
  }
}
