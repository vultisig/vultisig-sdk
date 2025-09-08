import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import type { Vault as CoreVault } from '@core/ui/vault/Vault'
import { memoizeAsync } from '@lib/utils/memoizeAsync'
import { initWasm } from '@trustwallet/wallet-core'
import type { WalletCore } from '@trustwallet/wallet-core'

import { AddressDeriver } from '../chains/AddressDeriver'
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

  // Cached properties to avoid repeated decoding
  private _isEncrypted?: boolean
  private _securityType?: 'fast' | 'secure'
  
  // Runtime properties (not stored in .vult file)
  private _userChains: string[] = []
  private _currency: string = 'USD'
  private _sdkInstance?: any // Reference to SDK for getting supported/default chains

  constructor(
    private vaultData: CoreVault,
    private walletCore?: WalletCore,
    sdkInstance?: any
  ) {
    console.log('Vault initialized:', {
      name: vaultData.name,
      publicKeys: vaultData.publicKeys,
      signers: vaultData.signers.length,
      hasWalletCore: !!walletCore,
    })

    // Store SDK reference for chain validation
    this._sdkInstance = sdkInstance
    
    // Initialize user chains from SDK defaults if available
    if (sdkInstance?.getDefaultChains) {
      this._userChains = [...sdkInstance.getDefaultChains()]
    } else {
      // Fallback to basic chains if no SDK instance
      this._userChains = ['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple']
    }
    
    // Initialize currency from SDK defaults if available
    if (sdkInstance?.getDefaultCurrency) {
      this._currency = sdkInstance.getDefaultCurrency()
    }

    // Initialize the address deriver if we have WalletCore
    if (walletCore) {
      this.addressDeriver.initialize(walletCore)
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
  private validateVaultName(name: string): { isValid: boolean; errors?: string[] } {
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
      errors.push('Vault name can only contain letters, numbers, spaces, hyphens, and underscores')
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    }
  }

  /**
   * Export vault data as a downloadable file
   */
  async export(password?: string): Promise<Blob> {
    const { createVaultBackup, getExportFileName } = await import('./utils/export')
    
    const base64Data = await createVaultBackup(this.vaultData, password)
    const filename = getExportFileName(this.vaultData)
    
    const blob = new Blob([base64Data], { type: 'application/octet-stream' })
    
    // Automatically download the file if we're in a browser environment
    if (typeof globalThis !== 'undefined' && 'window' in globalThis && 'document' in globalThis) {
      const { initiateFileDownload } = await import('@lib/ui/utils/initiateFileDownload')
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

    console.log('Deriving address for chain:', chainStr)
    const startTime = performance.now()

    // Check cache first (permanent caching for addresses as per architecture)
    const cacheKey = chainStr.toLowerCase()
    if (this.addressCache.has(cacheKey)) {
      const cachedAddress = this.addressCache.get(cacheKey)!
      console.log('Using cached address for', chainStr, ':', cachedAddress)
      const derivationTime = performance.now() - startTime
      console.log(
        `Derivation time for cached ${chainStr}:`,
        derivationTime.toFixed(2),
        'ms'
      )
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

      console.log('Successfully derived address for', chainStr, ':', address)

      // Cache the address (permanent caching as per architecture)
      this.addressCache.set(cacheKey, address)

      const derivationTime = performance.now() - startTime
      console.log(
        `Derivation time for ${chainStr}:`,
        derivationTime.toFixed(2),
        'ms'
      )

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
    const invalidChains = chains.filter(chain => !supportedChains.includes(chain))
    
    if (invalidChains.length > 0) {
      throw new Error(`Unsupported chains: ${invalidChains.join(', ')}. Supported chains: ${supportedChains.join(', ')}`)
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
    return this._userChains.length > 0 ? this._userChains : this.getSDKDefaultChains()
  }

  /**
   * Sign transaction (placeholder for future MPC implementation)
   */
  async signTransaction(tx: any, chain: string): Promise<any> {
    console.log('Signing transaction for chain:', chain)
    throw new Error(
      'signTransaction() not implemented yet - requires MPC integration'
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
}
