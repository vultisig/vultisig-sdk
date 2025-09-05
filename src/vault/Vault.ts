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

  constructor(
    private vaultData: CoreVault,
    private walletCore?: WalletCore
  ) {
    console.log('Vault initialized:', {
      name: vaultData.name,
      publicKeys: vaultData.publicKeys,
      signers: vaultData.signers.length,
      hasWalletCore: !!walletCore,
    })

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
   * Export vault data (placeholder for future implementation)
   */
  export(password?: string): Promise<ArrayBuffer> {
    console.log('Exporting vault with password protection:', !!password)
    throw new Error(
      'export() not implemented yet - requires backup mutation integration'
    )
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

  /**
   * Get default chains for address derivation
   */
  private getDefaultChains(): string[] {
    // Return commonly used chains as default
    return ['bitcoin', 'ethereum', 'thorchain', 'cosmos', 'solana']
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
   * Get list of supported chains for this vault
   */
  private getSupportedChains(): string[] {
    // For now, return a default set of chains
    // This could be enhanced to detect supported chains based on vault configuration
    return ['bitcoin', 'ethereum', 'thorchain', 'litecoin', 'solana']
  }

  /**
   * Get the underlying vault data
   */
  get data(): CoreVault {
    return this.vaultData
  }
}
