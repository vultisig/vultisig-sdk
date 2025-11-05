import { Vault as CoreVault } from '@core/mpc/vault/Vault'

// Core functions (functional dispatch) - Direct imports from core
import { Chain } from '@core/chain/Chain'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { getCoinBalance } from '@core/chain/coin/balance'
import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { getFeeQuote } from '@core/chain/feeQuote'

// SDK utilities
import {
  DEFAULT_CHAINS,
  isChainSupported,
  stringToChain,
} from '../chains/utils'
import { CacheService } from './services/CacheService'
import { FastSigningService } from './services/FastSigningService'
import { formatBalance } from './adapters/formatBalance'
import { formatGasInfo } from './adapters/formatGasInfo'
import { VaultError, VaultErrorCode } from './VaultError'
import { VaultServices, VaultConfig } from './VaultServices'

// Types
import {
  Balance,
  GasInfo,
  Signature,
  SigningMode,
  SigningPayload,
  Token,
} from '../types'

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
 *
 * Architecture:
 * - Vault → Core Functions (direct) → Chain Resolvers
 * - Aligns with core's functional dispatch pattern
 */
export class Vault {
  // Essential services only
  private wasmManager
  private cacheService: CacheService
  private fastSigningService?: FastSigningService

  // Cached properties
  private _isEncrypted?: boolean
  private _securityType?: 'fast' | 'secure'

  // Runtime state (not persisted)
  private _userChains: string[] = []
  private _currency: string = 'USD'
  private _tokens: Record<string, Token[]> = {}

  constructor(
    private vaultData: CoreVault,
    services: VaultServices,
    config?: VaultConfig
  ) {
    // Inject essential services
    this.wasmManager = services.wasmManager
    this.fastSigningService = services.fastSigningService
    this.cacheService = new CacheService()

    // Initialize user chains from config
    this._userChains = config?.defaultChains ?? DEFAULT_CHAINS

    // Initialize currency from config
    this._currency = config?.defaultCurrency ?? 'USD'
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

    this.vaultData.name = newName
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
      './utils/export'
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
  async address(chain: string | Chain): Promise<string> {
    const chainEnum = typeof chain === 'string' ? stringToChain(chain) : chain
    const cacheKey = `address:${chainEnum.toLowerCase()}`

    // Check permanent cache
    const cached = this.cacheService.get<string>(
      cacheKey,
      Number.MAX_SAFE_INTEGER
    )
    if (cached) return cached

    try {
      // Get WalletCore
      const walletCore = await this.wasmManager.getWalletCore()

      // Get public key using core
      const publicKey = getPublicKey({
        chain: chainEnum,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      // Derive address using core (handles all chain-specific logic)
      const address = deriveAddress({
        chain: chainEnum,
        publicKey,
        walletCore,
      })

      // Cache permanently (addresses don't change)
      this.cacheService.set(cacheKey, address)
      return address
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.AddressDerivationFailed,
        `Failed to derive address for ${chain}`,
        error as Error
      )
    }
  }

  /**
   * Get addresses for multiple chains
   */
  async addresses(chains?: string[]): Promise<Record<string, string>> {
    const chainsToDerive = chains || this._userChains
    const result: Record<string, string> = {}

    // Parallel derivation
    await Promise.all(
      chainsToDerive.map(async chain => {
        try {
          result[chain] = await this.address(chain)
        } catch (error) {
          console.warn(`Failed to derive address for ${chain}:`, error)
        }
      })
    )

    return result
  }

  // ===== BALANCE METHODS =====

  /**
   * Get balance for chain (with optional token)
   * Uses core's getCoinBalance() with 5-minute TTL cache
   */
  async balance(chain: string | Chain, tokenId?: string): Promise<Balance> {
    const chainEnum = typeof chain === 'string' ? stringToChain(chain) : chain
    const cacheKey = `balance:${chainEnum}:${tokenId ?? 'native'}`

    // Check 5-min TTL cache
    const cached = this.cacheService.get<Balance>(cacheKey, 5 * 60 * 1000)
    if (cached) return cached

    try {
      const address = await this.address(chainEnum)

      // Core handles balance fetching for ALL chains
      // Supports: native, ERC-20, SPL, wasm tokens automatically
      const rawBalance = await getCoinBalance({
        chain: chainEnum,
        address,
        id: tokenId, // Token ID (contract address for ERC-20, etc.)
      })

      // Format using adapter
      const balance = formatBalance(rawBalance, chain, tokenId, this._tokens)

      // Cache with 5-min TTL
      this.cacheService.set(cacheKey, balance)
      return balance
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.BalanceFetchFailed,
        `Failed to fetch balance for ${chain}${tokenId ? `:${tokenId}` : ''}`,
        error as Error
      )
    }
  }

  /**
   * Get balances for multiple chains
   */
  async balances(
    chains?: string[],
    includeTokens = false
  ): Promise<Record<string, Balance>> {
    const chainsToFetch = chains || this._userChains
    const result: Record<string, Balance> = {}

    for (const chain of chainsToFetch) {
      try {
        // Native balance
        result[chain] = await this.balance(chain)

        // Token balances
        if (includeTokens) {
          const tokens = this._tokens[chain] || []
          for (const token of tokens) {
            result[`${chain}:${token.id}`] = await this.balance(chain, token.id)
          }
        }
      } catch (error) {
        console.warn(`Failed to fetch balance for ${chain}:`, error)
      }
    }

    return result
  }

  /**
   * Force refresh balance (clear cache)
   */
  async updateBalance(chain: string, tokenId?: string): Promise<Balance> {
    const cacheKey = `balance:${chain}:${tokenId ?? 'native'}`
    this.cacheService.clear(cacheKey)
    return this.balance(chain, tokenId)
  }

  /**
   * Force refresh multiple balances
   */
  async updateBalances(
    chains?: string[],
    includeTokens = false
  ): Promise<Record<string, Balance>> {
    const chainsToUpdate = chains || this._userChains

    // Clear cache for all chains
    for (const chain of chainsToUpdate) {
      const cacheKey = `balance:${chain}:native`
      this.cacheService.clear(cacheKey)

      if (includeTokens) {
        const tokens = this._tokens[chain] || []
        for (const token of tokens) {
          const tokenCacheKey = `balance:${chain}:${token.id}`
          this.cacheService.clear(tokenCacheKey)
        }
      }
    }

    return this.balances(chainsToUpdate, includeTokens)
  }

  // ===== GAS ESTIMATION =====

  /**
   * Get gas info for chain
   * Uses core's getFeeQuote()
   */
  async gas(chain: string | Chain): Promise<GasInfo> {
    try {
      const chainEnum = typeof chain === 'string' ? stringToChain(chain) : chain
      const address = await this.address(chainEnum)

      // Core handles gas estimation for all chains
      // Need to provide full AccountCoin with metadata
      const feeQuote = await getFeeQuote({
        coin: {
          chain: chainEnum,
          address,
          decimals: chainFeeCoin[chainEnum].decimals,
          ticker: chainFeeCoin[chainEnum].ticker,
        },
      })

      // Format using adapter
      return formatGasInfo(feeQuote, chainEnum)
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.GasEstimationFailed,
        `Failed to estimate gas for ${chain}`,
        error as Error
      )
    }
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
      return await this.fastSigningService.signWithServer(
        this.vaultData,
        payload,
        password
      )
    } catch (error) {
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
  setTokens(chain: string, tokens: Token[]): void {
    this._tokens[chain] = tokens
  }

  /**
   * Add single token to chain
   */
  addToken(chain: string, token: Token): void {
    if (!this._tokens[chain]) this._tokens[chain] = []
    if (!this._tokens[chain].find(t => t.id === token.id)) {
      this._tokens[chain].push(token)
    }
  }

  /**
   * Remove token from chain
   */
  removeToken(chain: string, tokenId: string): void {
    if (this._tokens[chain]) {
      this._tokens[chain] = this._tokens[chain].filter(t => t.id !== tokenId)
    }
  }

  /**
   * Get tokens for chain
   */
  getTokens(chain: string): Token[] {
    return this._tokens[chain] || []
  }

  // ===== CHAIN MANAGEMENT =====

  /**
   * Set user chains
   */
  async setChains(chains: string[]): Promise<void> {
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
  }

  /**
   * Add single chain
   */
  async addChain(chain: string): Promise<void> {
    if (!isChainSupported(chain)) {
      throw new VaultError(
        VaultErrorCode.ChainNotSupported,
        `Chain not supported: ${chain}`
      )
    }

    if (!this._userChains.includes(chain)) {
      this._userChains.push(chain)
      await this.address(chain) // Pre-derive
    }
  }

  /**
   * Remove single chain
   */
  removeChain(chain: string): void {
    this._userChains = this._userChains.filter(c => c !== chain)

    // Clear address cache
    const cacheKey = `address:${chain.toLowerCase()}`
    this.cacheService.clear(cacheKey)
  }

  /**
   * Get current user chains
   */
  getChains(): string[] {
    return [...this._userChains]
  }

  /**
   * Reset to default chains
   */
  async resetToDefaultChains(): Promise<void> {
    this._userChains = DEFAULT_CHAINS
    await this.addresses(this._userChains)
  }

  /**
   * Get supported chains (alias for getChains)
   */
  private getSupportedChains(): string[] {
    return this.getChains()
  }

  // ===== CURRENCY MANAGEMENT =====

  /**
   * Set vault currency
   */
  setCurrency(currency: string): void {
    this._currency = currency
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
