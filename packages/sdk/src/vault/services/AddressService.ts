import { Chain } from '@core/chain/Chain'
import { deriveAddress } from '@core/chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import type { Vault as CoreVault } from '@core/mpc/vault/Vault'

import { WasmManager } from '../../runtime/wasm'
import { CacheScope, type CacheService } from '../../services/CacheService'
import { VaultError, VaultErrorCode } from '../VaultError'

/**
 * AddressService
 *
 * Handles address derivation and caching for vault chains.
 * Uses CacheService with ADDRESS scope for automatic storage persistence.
 */
export class AddressService {
  constructor(
    private vaultData: CoreVault,
    private cacheService: CacheService
  ) {}

  /**
   * Get address for specified chain
   * Uses CacheService with automatic persistent caching
   */
  async getAddress(chain: Chain): Promise<string> {
    return this.cacheService.getOrComputeScoped(chain.toLowerCase(), CacheScope.ADDRESS, async () => {
      // Derive address (expensive WASM operation)
      try {
        const walletCore = await WasmManager.getWalletCore()

        const publicKey = getPublicKey({
          chain,
          walletCore,
          publicKeys: this.vaultData.publicKeys,
          hexChainCode: this.vaultData.hexChainCode,
        })

        return deriveAddress({
          chain,
          publicKey,
          walletCore,
        })
      } catch (error) {
        throw new VaultError(
          VaultErrorCode.AddressDerivationFailed,
          `Failed to derive address for ${chain}`,
          error as Error
        )
      }
    })
  }

  /**
   * Get addresses for multiple chains
   */
  async getAddresses(chains?: Chain[]): Promise<Record<string, string>> {
    if (!chains || chains.length === 0) {
      return {}
    }

    const result: Record<string, string> = {}

    // Parallel derivation
    await Promise.all(
      chains.map(async chain => {
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
