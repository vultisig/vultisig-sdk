import { deriveAddress } from '../core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '../core/chain/publicKey/getPublicKey'
import type { Vault as CoreVault } from '../core/ui/vault/Vault'
import { memoizeAsync } from '../lib/utils/memoizeAsync'
import type { WalletCore } from '@trustwallet/wallet-core'
import { initWasm } from '@trustwallet/wallet-core'

import { AddressDeriver } from '../chains/AddressDeriver'
import { ChainManager } from '../chains/ChainManager'
import type { Balance, CachedBalance, SigningMode, SigningPayload, Signature } from '../types'
import type { WASMManager } from '../wasm/WASMManager'
import { VaultError, VaultErrorCode } from './VaultError'

// Use the same memoized WalletCore instance as the extension
const getWalletCore = memoizeAsync(initWasm)

type AddressInput = {
  chain: string
  walletCore: WalletCore
}

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
 * Vault class for handling vault operations
 * Implements deriveAddress for Bitcoin and other chains
 * Following vault-centric architecture with debugging support
 */
export class Vault {
  private addressCache = new Map<string, string>()
  private addressDeriver = new AddressDeriver()
  private chainManager?: ChainManager

  // Cached properties to avoid repeated decoding
  private _isEncrypted?: boolean
  private _securityType?: 'fast' | 'secure'

  // Runtime properties (not stored in .vult file)
  private _userChains: string[] = []
  private _currency: string = 'USD'
  private _sdkInstance?: any // Reference to SDK for getting supported/default chains
  private _balanceCache = new Map<string, CachedBalance>() // TTL balance caching (5 minutes)

  constructor(
    private vaultData: CoreVault,
    private walletCore?: WalletCore,
    private wasmManager?: WASMManager,
    sdkInstance?: any
  ) {
    // Vault initialized

    // Store SDK reference for chain validation
    this._sdkInstance = sdkInstance

    // Initialize user chains from SDK defaults if available
    if (sdkInstance?.getDefaultChains) {
      this._userChains = [...sdkInstance.getDefaultChains()]
    } else {
      // Fallback to basic chains if no SDK instance
      this._userChains = [
        'Bitcoin',
        'Ethereum',
        'Solana',
        'THORChain',
        'Ripple',
      ]
    }

    // Initialize currency from SDK defaults if available
    if (sdkInstance?.getDefaultCurrency) {
      this._currency = sdkInstance.getDefaultCurrency()
    }

    // Initialize the address deriver if we have WalletCore
    if (walletCore) {
      this.addressDeriver.initialize(walletCore)
    }

    // Initialize ChainManager if we have WASMManager
    if (wasmManager) {
      this.chainManager = new ChainManager(wasmManager)
      this.chainManager.initialize().catch(error => {
        console.warn('Failed to initialize ChainManager:', error)
      })
    }
  }

  /**
   * Get vault summary information
   */
  summary() {
    return {
      id: this.vaultData.publicKeys.ecdsa,
      name: this.vaultData.name,
      type: this._securityType ?? determineVaultType(this.vaultData.signers),
      chains: this.getSupportedChains(),
      createdAt: this.vaultData.createdAt,
      isBackedUp: this.vaultData.isBackedUp,
    }
  }

  /**
   * Set cached encryption status (called during import to avoid repeated decoding)
   */
  setCachedEncryptionStatus(isEncrypted: boolean): void {
    this._isEncrypted = isEncrypted
  }

  /**
   * Get cached encryption status (returns undefined if not cached)
   */
  getCachedEncryptionStatus(): boolean | undefined {
    return this._isEncrypted
  }

  /**
   * Set cached security type (called during import to avoid repeated calculation)
   */
  setCachedSecurityType(securityType: 'fast' | 'secure'): void {
    this._securityType = securityType
  }

  /**
   * Get cached security type (returns undefined if not cached)
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

    // Update internal vault data directly
    this.vaultData.name = newName
  }

  /**
   * Validate vault name according to established rules
   */
  private validateVaultName(name: string): {
    isValid: boolean
    errors?: string[]
  } {
    const errors: string[] = []

    // Check if name is empty or only whitespace
    if (!name || name.trim().length === 0) {
      errors.push('Vault name cannot be empty')
    }

    // Check minimum length (2 characters as per UI validation)
    if (name.length < 2) {
      errors.push('Vault name must be at least 2 characters long')
    }

    // Check maximum length (50 characters as per UI validation)
    if (name.length > 50) {
      errors.push('Vault name cannot exceed 50 characters')
    }

    // Check allowed characters (letters, numbers, spaces, hyphens, underscores)
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
   * Export vault data as a downloadable file
   */
  async export(password?: string): Promise<Blob> {
    const { createVaultBackup, getExportFileName } = await import(
      './utils/export'
    )

    const base64Data = await createVaultBackup(this.vaultData, password)
    const filename = getExportFileName(this.vaultData)

    const blob = new Blob([base64Data], { type: 'application/octet-stream' })

    // Automatically download the file if we're in a browser environment
    if (typeof globalThis !== 'undefined' && 'window' in globalThis && 'document' in globalThis) {
      const { initiateFileDownload } = await import('../lib/ui/utils/initiateFileDownload')
      initiateFileDownload({ blob, name: filename })
    }

    return blob
  }

  /**
   * Delete vault data (placeholder for future implementation)
   */
  delete(): Promise<void> {
    console.log('Deleting vault:', this.vaultData.name)
    throw new Error(
      'delete() not implemented yet - requires storage integration'
    )
  }

  /**
   * Get address for specified chain
   * Uses AddressDeriver for consistent address derivation
   */
  async address(chain: string): Promise<string>
  async address(input: string | AddressInput): Promise<string> {
    // Handle both signatures: address(chain) and address({ chain, walletCore })
    let chainStr: string
    let walletCoreToUse: WalletCore | undefined

    if (typeof input === 'string') {
      chainStr = input
      walletCoreToUse = this.walletCore
    } else {
      chainStr = input.chain
      walletCoreToUse = input.walletCore || this.walletCore
    }

    const startTime = performance.now()

    // Check cache first (permanent caching for addresses as per architecture)
    const cacheKey = chainStr.toLowerCase()
    if (this.addressCache.has(cacheKey)) {
      const cachedAddress = this.addressCache.get(cacheKey)!
      const derivationTime = performance.now() - startTime
      return cachedAddress
    }

    try {
      // Ensure we have WalletCore
      if (!walletCoreToUse) {
        throw new VaultError(
          VaultErrorCode.WalletCoreNotInitialized,
          'WalletCore instance is required for address derivation'
        )
      }

      // Get WalletCore using the same memoized instance as the extension
      const walletCore = await getWalletCore()

      // Map string to Chain enum (using AddressDeriver's mapping)
      const chain = this.addressDeriver.mapStringToChain(chainStr)

      // Get the proper public key for this chain
      const publicKey = getPublicKey({
        chain,
        walletCore,
        hexChainCode: this.vaultData.hexChainCode,
        publicKeys: this.vaultData.publicKeys,
      })

      // Derive the address using core functionality
      const address = deriveAddress({
        chain,
        publicKey,
        walletCore,
      })

      // Cache the address (permanent caching as per architecture)
      this.addressCache.set(cacheKey, address)

      const derivationTime = performance.now() - startTime

      return address
    } catch (error) {
      console.error('Failed to derive address for', chainStr, ':', error)

      if (error instanceof VaultError) {
        throw error
      }

      // Check for specific error types and throw appropriate VaultError
      if (
        (error as Error).message.includes('Unsupported chain') ||
        (error as Error).message.includes('Chain not supported')
      ) {
        throw new VaultError(
          VaultErrorCode.ChainNotSupported,
          `Chain not supported: ${chainStr}`,
          error as Error
        )
      }

      if (
        (error as Error).message.includes('network') ||
        (error as Error).message.includes('Network')
      ) {
        throw new VaultError(
          VaultErrorCode.NetworkError,
          `Network error during address derivation for ${chainStr}`,
          error as Error
        )
      }

      throw new VaultError(
        VaultErrorCode.AddressDerivationFailed,
        `Failed to derive address for ${chainStr}: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Get addresses for multiple chains
   * Implements the addresses() method from VAULTPLAN.md
   */
  async addresses(chains?: string[]): Promise<Record<string, string>> {
    const chainsToDerive = chains || this.getDefaultChains()
    const addresses: Record<string, string> = {}

    for (const chain of chainsToDerive) {
      try {
        addresses[chain] = await this.address(chain)
      } catch (error) {
        console.warn(`Failed to derive address for ${chain}:`, error)
        // Skip chains that fail to derive
      }
    }

    return addresses
  }

  // === BALANCE METHODS ===

  /**
   * Get balance for a specific chain
   * Implements vault-centric balance fetching with 5-minute TTL caching
   * @param chain - Chain name (e.g., 'Bitcoin', 'Ethereum')
   * @param tokenId - Optional token ID for token-specific balances
   * @returns Promise resolving to Balance object
   */
  async balance(chain: string, tokenId?: string): Promise<Balance> {
    // Validate ChainManager availability
    if (!this.chainManager) {
      throw new VaultError(
        VaultErrorCode.WalletCoreNotInitialized,
        'ChainManager not available - WASMManager required for balance operations'
      )
    }

    // Check cache first
    const cachedBalance = this.getCachedBalance(chain, tokenId)
    if (cachedBalance) {
      return cachedBalance
    }

    try {
      // Get address for the chain
      const address = await this.address(chain)

      // For now, only support native token balances (tokenId must be undefined)
      if (tokenId) {
        throw new VaultError(
          VaultErrorCode.UnsupportedToken,
          `Token-specific balances not yet supported. Token: ${tokenId} on ${chain}`,
          new Error('Token balance support not implemented')
        )
      }

      // Get balance from ChainManager
      const balance = await this.chainManager.getBalances({
        [chain]: address,
      })
      const chainBalance = balance[chain as keyof typeof balance]

      if (!chainBalance) {
        throw new VaultError(
          VaultErrorCode.BalanceFetchFailed,
          `Failed to get balance for ${chain} - no balance returned from ChainManager`
        )
      }

      // Cache the result
      this.storeBalanceInCache(chain, tokenId, chainBalance)

      return chainBalance
    } catch (error) {
      console.error(
        `Failed to get balance for ${chain}${tokenId ? `:${tokenId}` : ''}:`,
        error
      )

      if (error instanceof VaultError) {
        throw error
      }

      // Wrap unexpected errors
      throw new VaultError(
        VaultErrorCode.BalanceFetchFailed,
        `Failed to get balance for ${chain}${tokenId ? `:${tokenId}` : ''}: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Get balances for multiple chains
   * Implements batch balance fetching with intelligent caching
   * @param chains - Optional array of chain names. Uses vault's chains if not provided
   * @param includeTokens - Whether to include token balances (not yet implemented)
   * @returns Promise resolving to record of chain -> Balance
   */
  async balances(
    chains?: string[],
    includeTokens?: boolean
  ): Promise<Record<string, Balance>> {
    // Validate ChainManager availability
    if (!this.chainManager) {
      throw new VaultError(
        VaultErrorCode.WalletCoreNotInitialized,
        'ChainManager not available - WASMManager required for balance operations'
      )
    }

    // Determine which chains to fetch
    const chainsToFetch = chains || this.getChains()

    // Token support not yet implemented
    if (includeTokens) {
      throw new VaultError(
        VaultErrorCode.UnsupportedToken,
        'Token balance fetching not yet supported in batch operations'
      )
    }

    const result: Record<string, Balance> = {}
    const addressesToFetch: Record<string, string> = {}

    // First, check cache for existing balances and collect missing ones
    for (const chain of chainsToFetch) {
      const cachedBalance = this.getCachedBalance(chain)
      if (cachedBalance) {
        result[chain] = cachedBalance
      } else {
        try {
          // Get address for chains that need fresh data
          const address = await this.address(chain)
          addressesToFetch[chain] = address
        } catch (error) {
          console.warn(
            `Failed to derive address for ${chain}, skipping:`,
            error
          )
          // Skip chains where address derivation fails
        }
      }
    }

    // If we have chains to fetch fresh data for, batch them
    if (Object.keys(addressesToFetch).length > 0) {
      try {
        const freshBalances =
          await this.chainManager.getBalances(addressesToFetch)

        // Store results and add to cache
        for (const [chain, balance] of Object.entries(freshBalances)) {
          if (balance) {
            result[chain] = balance
            this.storeBalanceInCache(chain, undefined, balance)
          } else {
            console.warn(`No balance returned for ${chain}`)
          }
        }
      } catch (error) {
        console.error('Failed to fetch batch balances:', error)

        // On batch failure, try individual fetches as fallback
        for (const chain of Object.keys(addressesToFetch)) {
          try {
            const balance = await this.balance(chain)
            result[chain] = balance
          } catch (individualError) {
            console.error(
              `Failed to get balance for ${chain}:`,
              individualError
            )
            // Skip failed chains - they won't be in the result
          }
        }
      }
    }

    return result
  }

  /**
   * Force refresh balance for a specific chain (bypasses cache)
   * @param chain - Chain name (e.g., 'Bitcoin', 'Ethereum')
   * @param tokenId - Optional token ID for token-specific balances
   * @returns Promise resolving to fresh Balance object
   */
  async updateBalance(chain: string, tokenId?: string): Promise<Balance> {
    // Validate ChainManager availability
    if (!this.chainManager) {
      throw new VaultError(
        VaultErrorCode.WalletCoreNotInitialized,
        'ChainManager not available - WASMManager required for balance operations'
      )
    }

    try {
      // Clear existing cache entry to force fresh fetch
      this.clearCacheEntry(chain, tokenId)

      // Get address for the chain
      const address = await this.address(chain)

      // For now, only support native token balances
      if (tokenId) {
        throw new VaultError(
          VaultErrorCode.UnsupportedToken,
          `Token-specific balances not yet supported. Token: ${tokenId} on ${chain}`,
          new Error('Token balance support not implemented')
        )
      }

      // Get fresh balance from ChainManager
      console.log(`Force refreshing balance for ${chain}:${address}`)
      const balances = await this.chainManager.getBalances({
        [chain]: address,
      })
      const chainBalance = balances[chain as keyof typeof balances]

      if (!chainBalance) {
        throw new VaultError(
          VaultErrorCode.BalanceFetchFailed,
          `Failed to get fresh balance for ${chain} - no balance returned from ChainManager`
        )
      }

      // Cache the fresh result
      this.storeBalanceInCache(chain, tokenId, chainBalance)

      return chainBalance
    } catch (error) {
      console.error(
        `Failed to update balance for ${chain}${tokenId ? `:${tokenId}` : ''}:`,
        error
      )

      if (error instanceof VaultError) {
        throw error
      }

      // Wrap unexpected errors
      throw new VaultError(
        VaultErrorCode.BalanceFetchFailed,
        `Failed to update balance for ${chain}${tokenId ? `:${tokenId}` : ''}: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Force refresh balances for multiple chains (bypasses cache)
   * @param chains - Optional array of chain names. Uses vault's chains if not provided
   * @param includeTokens - Whether to include token balances (not yet implemented)
   * @returns Promise resolving to record of chain -> fresh Balance
   */
  async updateBalances(
    chains?: string[],
    includeTokens?: boolean
  ): Promise<Record<string, Balance>> {
    // Validate ChainManager availability
    if (!this.chainManager) {
      throw new VaultError(
        VaultErrorCode.WalletCoreNotInitialized,
        'ChainManager not available - WASMManager required for balance operations'
      )
    }

    // Determine which chains to update
    const chainsToUpdate = chains || this.getChains()

    // Token support not yet implemented
    if (includeTokens) {
      throw new VaultError(
        VaultErrorCode.UnsupportedToken,
        'Token balance fetching not yet supported in batch operations'
      )
    }

    const result: Record<string, Balance> = {}
    const addressesToFetch: Record<string, string> = {}

    // Clear cache entries for all chains we're updating
    for (const chain of chainsToUpdate) {
      this.clearCacheEntry(chain, undefined)
    }

    // Get addresses for all chains
    for (const chain of chainsToUpdate) {
      try {
        const address = await this.address(chain)
        addressesToFetch[chain] = address
      } catch (error) {
        console.warn(`Failed to derive address for ${chain}, skipping:`, error)
        // Skip chains where address derivation fails
      }
    }

    // If we have chains to update, batch them
    if (Object.keys(addressesToFetch).length > 0) {
      try {
        console.log(
          `Force refreshing balances for ${Object.keys(addressesToFetch).length} chains`
        )
        const freshBalances =
          await this.chainManager.getBalances(addressesToFetch)

        // Store results and update cache
        for (const [chain, balance] of Object.entries(freshBalances)) {
          if (balance) {
            result[chain] = balance
            this.storeBalanceInCache(chain, undefined, balance)
          } else {
            console.warn(`No balance returned for ${chain}`)
          }
        }
      } catch (error) {
        console.error('Failed to update batch balances:', error)

        // On batch failure, try individual updates as fallback
        console.log('Falling back to individual balance updates')
        for (const chain of Object.keys(addressesToFetch)) {
          try {
            const balance = await this.updateBalance(chain)
            result[chain] = balance
          } catch (individualError) {
            console.error(
              `Failed to update balance for ${chain}:`,
              individualError
            )
            // Skip failed chains - they won't be in the result
          }
        }
      }
    }

    return result
  }

  // === USER CHAIN MANAGEMENT ===

  /**
   * Set user chains (triggers address/balance updates)
   */
  async setChains(chains: string[]): Promise<void> {
    this.validateChains(chains)
    this._userChains = [...chains]

    // Clear address cache for removed chains
    const currentCacheKeys = Array.from(this.addressCache.keys())
    const newChainKeys = chains.map(chain => chain.toLowerCase())

    for (const cacheKey of currentCacheKeys) {
      if (!newChainKeys.includes(cacheKey)) {
        this.addressCache.delete(cacheKey)
      }
    }

    // Pre-derive addresses for new chains
    await this.addresses(chains)
  }

  /**
   * Add single chain (triggers address/balance updates)
   */
  async addChain(chain: string): Promise<void> {
    this.validateChains([chain])

    if (!this._userChains.includes(chain)) {
      this._userChains.push(chain)
      // Pre-derive address for new chain
      await this.address(chain)
    }
  }

  /**
   * Remove single chain
   */
  removeChain(chain: string): void {
    this._userChains = this._userChains.filter(c => c !== chain)

    // Clear address cache for removed chain
    this.addressCache.delete(chain.toLowerCase())
  }

  /**
   * Get current user chains
   */
  getChains(): string[] {
    return [...this._userChains]
  }

  /**
   * Reset to SDK default chains
   */
  async resetToDefaultChains(): Promise<void> {
    const defaultChains = this.getSDKDefaultChains()
    await this.setChains(defaultChains)
  }

  // === CURRENCY MANAGEMENT ===

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

  // === PRIVATE HELPERS ===

  /**
   * Validate chains against supported chains list
   */
  private validateChains(chains: string[]): void {
    if (!this._sdkInstance?.getSupportedChains) {
      return // Skip validation if no SDK instance
    }

    const supportedChains = this._sdkInstance.getSupportedChains()
    const invalidChains = chains.filter(
      chain => !supportedChains.includes(chain)
    )

    if (invalidChains.length > 0) {
      throw new Error(
        `Unsupported chains: ${invalidChains.join(', ')}. Supported chains: ${supportedChains.join(', ')}`
      )
    }
  }

  /**
   * Get SDK default chains or fallback
   */
  private getSDKDefaultChains(): string[] {
    if (this._sdkInstance?.getDefaultChains) {
      return this._sdkInstance.getDefaultChains()
    }
    // Fallback to basic chains if no SDK instance
    return ['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple']
  }

  /**
   * Get default chains for address derivation (uses user chains)
   */
  private getDefaultChains(): string[] {
    return this._userChains.length > 0
      ? this._userChains
      : this.getSDKDefaultChains()
  }

  /**
   * Sign transaction using specified mode
   */
  async sign(mode: SigningMode, payload: SigningPayload, password?: string): Promise<Signature> {
    console.log('Signing transaction with mode:', mode)
    
    // Validate vault supports the requested mode
    this.validateSigningMode(mode)
    
    // Route to appropriate signing implementation
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
   * Validate that the vault supports the requested signing mode
   */
  private validateSigningMode(mode: SigningMode): void {
    const securityType = this._securityType ?? determineVaultType(this.vaultData.signers)
    
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
   * Sign transaction using VultiServer (fast mode)
   */
  private async signFast(payload: SigningPayload, password?: string): Promise<Signature> {
    // Get SDK instance to access server manager
    if (!this._sdkInstance) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'SDK instance required for fast signing'
      )
    }

    // Validate we have a server manager
    const serverManager = this._sdkInstance.getServerManager()
    if (!serverManager) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'Server manager not available for fast signing'
      )
    }

    try {
      // Validate password is provided for fast signing
      if (!password) {
        throw new VaultError(
          VaultErrorCode.InvalidConfig,
          'Password is required for fast signing'
        )
      }
      
      // Use server manager to perform fast signing
      return await serverManager.signWithServer(this.vaultData, payload, password)
    } catch (error) {
      console.error('Fast signing failed:', error)
      
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

  /**
   * Sign with raw transaction payload (public method for CLI)
   * Converts raw transaction data to proper format and delegates to signTransaction
   */
  async signWithPayload(payload: SigningPayload, password?: string): Promise<Signature> {
    try {
      // For now, delegate to the existing signTransaction method
      // The signTransaction method should handle the conversion internally
      return await this.signTransaction(payload.transaction, payload.chain, password)
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.SigningFailed,
        `Failed to sign with payload: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Sign transaction (legacy method - deprecated, use sign() instead)
   */
  async signTransaction(tx: any, chain: string, password?: string): Promise<any> {
    console.log('Legacy signTransaction called for chain:', chain)
    console.warn('signTransaction() is deprecated, use sign() method instead')
    
    // Convert to new API format
    const payload: SigningPayload = {
      transaction: tx,
      chain
    }
    
    // Default to fast mode for fast vaults, otherwise throw error
    const securityType = this._securityType ?? determineVaultType(this.vaultData.signers)
    if (securityType === 'fast') {
      return this.sign('fast', payload, password)
    }
    
    throw new Error(
      'signTransaction() deprecated - use sign("fast"|"relay"|"local", payload) instead'
    )
  }

  /**
   * Estimate gas for transaction (placeholder for future implementation)
   */
  async estimateGas(tx: any, chain: string): Promise<any> {
    console.log('Estimating gas for chain:', chain)
    throw new Error(
      'estimateGas() not implemented yet - requires chain-specific integration'
    )
  }

  /**
   * Get list of supported chains for this vault (uses user chains)
   */
  private getSupportedChains(): string[] {
    return this.getChains()
  }

  /**
   * Get the underlying vault data
   */
  get data(): CoreVault {
    return this.vaultData
  }

  // === PRIVATE BALANCE CACHE HELPERS ===

  /**
   * Generate cache key for balance entries
   * Format: `${chain}:${tokenId || 'native'}`
   */
  private getCacheKey(chain: string, tokenId?: string): string {
    const normalizedChain = chain.toLowerCase()
    const tokenKey = tokenId || 'native'
    return `${normalizedChain}:${tokenKey}`
  }

  /**
   * Check if cached balance is still valid (not expired)
   */
  private isCacheValid(cachedBalance: CachedBalance): boolean {
    const now = Date.now()
    const expiresAt = cachedBalance.cachedAt + cachedBalance.ttl
    return now < expiresAt
  }

  /**
   * Clear expired entries from balance cache
   */
  private clearExpiredCache(): void {
    for (const [key, cachedBalance] of this._balanceCache.entries()) {
      if (!this.isCacheValid(cachedBalance)) {
        this._balanceCache.delete(key)
      }
    }
  }

  /**
   * Clear specific cache entry
   */
  private clearCacheEntry(chain: string, tokenId?: string): void {
    const cacheKey = this.getCacheKey(chain, tokenId)
    this._balanceCache.delete(cacheKey)
  }

  /**
   * Store balance in cache with TTL
   */
  private storeBalanceInCache(
    chain: string,
    tokenId: string | undefined,
    balance: import('../types').Balance
  ): void {
    const cacheKey = this.getCacheKey(chain, tokenId)
    const cachedBalance: CachedBalance = {
      balance,
      cachedAt: Date.now(),
      ttl: 5 * 60 * 1000, // 5 minutes in milliseconds
    }
    this._balanceCache.set(cacheKey, cachedBalance)
  }

  /**
   * Get balance from cache if valid
   */
  private getCachedBalance(
    chain: string,
    tokenId?: string
  ): import('../types').Balance | null {
    const cacheKey = this.getCacheKey(chain, tokenId)
    const cachedBalance = this._balanceCache.get(cacheKey)

    if (!cachedBalance || !this.isCacheValid(cachedBalance)) {
      if (cachedBalance) {
        // Remove expired entry
        this._balanceCache.delete(cacheKey)
      }
      return null
    }

    return cachedBalance.balance
  }
}
