import { Chain } from '@vultisig/core-chain/Chain'
import { defaultTonWalletVersion, type TonWalletVersion } from '@vultisig/core-chain/chains/ton/wallet'
import { deriveAddress } from '@vultisig/core-chain/publicKey/address/deriveAddress'
import { deriveQbtcAddress } from '@vultisig/core-chain/publicKey/address/deriveQbtcAddress'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import type { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'

import type { WasmProvider } from '../../context/SdkContext'
import { CacheScope, type CacheService } from '../../services/CacheService'
import { assertValidChain } from '../../utils/chainValidation'
import { VaultError, VaultErrorCode } from '../VaultError'

/**
 * AddressService
 *
 * Handles address derivation and caching for vault chains.
 * Uses CacheService with ADDRESS scope for automatic storage persistence.
 */
export type GetAddressOptions = {
  /** TON only: which wallet contract to derive. Defaults to V4R2. */
  tonWalletVersion?: TonWalletVersion
}

export class AddressService {
  constructor(
    private vaultData: CoreVault,
    private cacheService: CacheService,
    private wasmProvider: WasmProvider
  ) {}

  /**
   * Get address for specified chain
   * Uses CacheService with automatic persistent caching
   *
   * For TON, `options.tonWalletVersion` selects the wallet contract. The default
   * is V4R2 — the account every existing vault already uses; `'v5r1'` is the same
   * key's W5 account, cached under its own key so the two never alias.
   */
  async getAddress(chain: Chain, options: GetAddressOptions = {}): Promise<string> {
    assertValidChain(chain)
    const tonWalletVersion = chain === Chain.Ton ? (options.tonWalletVersion ?? defaultTonWalletVersion) : undefined
    const cacheKey =
      tonWalletVersion && tonWalletVersion !== defaultTonWalletVersion
        ? `${chain.toLowerCase()}:${tonWalletVersion}`
        : chain.toLowerCase()
    return this.cacheService.getOrComputeScoped(cacheKey, CacheScope.ADDRESS, async () => {
      // Derive address (expensive WASM operation)
      try {
        if (chain === Chain.QBTC) {
          if (!this.vaultData.publicKeyMldsa) {
            throw new Error('Vault has no MLDSA public key (required for QBTC address derivation)')
          }
          return deriveQbtcAddress(this.vaultData.publicKeyMldsa)
        }

        const walletCore = await this.wasmProvider.getWalletCore()

        const publicKey = getPublicKey({
          chain,
          walletCore,
          publicKeys: this.vaultData.publicKeys,
          hexChainCode: this.vaultData.hexChainCode,
          chainPublicKeys: this.vaultData.chainPublicKeys,
        })

        return deriveAddress({
          chain,
          publicKey,
          walletCore,
          tonWalletVersion,
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
