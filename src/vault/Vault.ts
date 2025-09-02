import { Chain } from '@core/chain/Chain'
import { deriveAddress as coreDerive } from '@core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import type { Vault as CoreVault } from '@core/ui/vault/Vault'
import type { WalletCore } from '@trustwallet/wallet-core'

import { VaultError, VaultErrorCode } from './VaultError'

type DeriveAddressInput = {
  chain: string
  walletCore: WalletCore
}

/**
 * Vault class for handling vault operations
 * Implements deriveAddress for Bitcoin and other chains
 * Following vault-centric architecture with debugging support
 */
export class Vault {
  private addressCache = new Map<string, string>()

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
  }

  /**
   * Get vault summary information
   */
  summary() {
    return {
      id: this.vaultData.publicKeys.ecdsa,
      name: this.vaultData.name,
      type: this.vaultData.signers.length === 2 ? 'fast' : 'secure',
      chains: this.getSupportedChains(),
      createdAt: this.vaultData.createdAt,
      isBackedUp: this.vaultData.isBackedUp,
    }
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
   * Derive address for specified chain
   * Implements Bitcoin address derivation with debugging logs
   * Uses WalletCore WASM for derivation logic
   */
  async deriveAddress(chain: string): Promise<string>
  async deriveAddress(input: string | DeriveAddressInput): Promise<string> {
    // Handle both signatures: deriveAddress(chain) and deriveAddress({ chain, walletCore })
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
      // Validate inputs
      if (!walletCoreToUse) {
        throw new VaultError(
          VaultErrorCode.WalletCoreNotInitialized,
          'WalletCore instance is required for address derivation'
        )
      }

      if (!this.vaultData.publicKeys) {
        throw new VaultError(
          VaultErrorCode.InvalidVault,
          'Vault public keys are missing'
        )
      }

      if (!this.vaultData.hexChainCode) {
        throw new VaultError(
          VaultErrorCode.InvalidChainCode,
          'Vault chain code is missing'
        )
      }

      // Map string to Chain enum
      const chainEnum = this.mapStringToChain(chainStr)
      console.log('Mapped chain string', chainStr, 'to enum:', chainEnum)

      // Special handling for Bitcoin
      if (chainEnum === Chain.Bitcoin) {
        console.log('Processing Bitcoin address derivation')
        console.log('Vault public keys:', this.vaultData.publicKeys)
        console.log('Vault chain code:', this.vaultData.hexChainCode)
      }

      // Get the proper public key for this chain
      const publicKey = getPublicKey({
        chain: chainEnum,
        walletCore: walletCoreToUse,
        hexChainCode: this.vaultData.hexChainCode,
        publicKeys: this.vaultData.publicKeys,
      })

      console.log(
        'Derived public key for',
        chainStr,
        '- length:',
        publicKey.data().length
      )

      // Derive the address using core functionality
      const address = coreDerive({
        chain: chainEnum,
        publicKey,
        walletCore: walletCoreToUse,
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
        (error as Error).message.includes('chain') ||
        (error as Error).message.includes('Chain')
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
   * Map string chain names to Chain enum values
   */
  private mapStringToChain(chainStr: string): Chain {
    const normalizedChain = chainStr.toLowerCase()
    console.log('Mapping chain string:', normalizedChain)

    // Map common string names to Chain enum values
    const chainMap: Record<string, Chain> = {
      bitcoin: Chain.Bitcoin,
      btc: Chain.Bitcoin,
      ethereum: Chain.Ethereum,
      eth: Chain.Ethereum,
      thorchain: Chain.THORChain,
      thor: Chain.THORChain,
      litecoin: Chain.Litecoin,
      ltc: Chain.Litecoin,
      bitcoincash: Chain.BitcoinCash,
      bch: Chain.BitcoinCash,
      dogecoin: Chain.Dogecoin,
      doge: Chain.Dogecoin,
      solana: Chain.Solana,
      sol: Chain.Solana,
      cosmos: Chain.Cosmos,
      atom: Chain.Cosmos,
      polygon: Chain.Polygon,
      matic: Chain.Polygon,
      avalanche: Chain.Avalanche,
      avax: Chain.Avalanche,
      bsc: Chain.BSC,
      bnb: Chain.BSC,
    }

    const mappedChain = chainMap[normalizedChain]
    if (!mappedChain) {
      console.error('Unsupported chain:', chainStr)
      throw new VaultError(
        VaultErrorCode.ChainNotSupported,
        `Chain not supported: ${chainStr}. Supported chains: ${Object.keys(chainMap).join(', ')}`
      )
    }

    console.log('Successfully mapped', chainStr, 'to', mappedChain)
    return mappedChain
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
