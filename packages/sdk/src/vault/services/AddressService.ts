import { Chain } from '@core/chain/Chain'
import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import type { Vault as CoreVault } from '@core/mpc/vault/Vault'

import type { CacheService } from '../../services/CacheService'
import { WASMManager } from '../../wasm/WASMManager'
import { VaultError, VaultErrorCode } from '../VaultError'

/**
 * AddressService
 *
 * Handles address derivation and caching for vault chains.
 * Extracted from Vault.ts to reduce file size and improve maintainability.
 */
export class AddressService {
  constructor(
    private vaultData: CoreVault,
    private wasmManager: WASMManager,
    private cacheService: CacheService,
    private getUserChains: () => Chain[]
  ) {}

  /**
   * Get address for specified chain
   * Uses core's deriveAddress() with permanent caching
   */
  async getAddress(chain: Chain): Promise<string> {
    const cacheKey = `address:${chain.toLowerCase()}`

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
        chain,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      // Derive address using core (handles all chain-specific logic)
      const address = deriveAddress({
        chain,
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
  async getAddresses(chains?: Chain[]): Promise<Record<string, string>> {
    const chainsToDerive = chains || this.getUserChains()
    const result: Record<string, string> = {}

    // Parallel derivation
    await Promise.all(
      chainsToDerive.map(async chain => {
        try {
          result[chain] = await this.getAddress(chain)
        } catch (error) {
          console.warn(`Failed to derive address for ${chain}:`, error)
        }
      })
    )

    return result
  }
}
