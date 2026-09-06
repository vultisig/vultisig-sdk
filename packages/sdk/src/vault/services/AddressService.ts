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
  private tonWalletVersion: TonWalletVersion = defaultTonWalletVersion

  constructor(
    private vaultData: CoreVault,
    private cacheService: CacheService,
    private wasmProvider: WasmProvider
  ) {}

  /**
   * The TON wallet contract this vault's account lives in. Every address lookup
   * that does not name a version — including the ones behind `send`, balances,
   * swaps and fee estimation — resolves to this account, so selecting W5 here is
   * what makes the whole vault act on the W5 account rather than only `address()`.
   */
  getTonWalletVersion(): TonWalletVersion {
    return this.tonWalletVersion
  }

  /** Selects which of the key's two TON accounts the vault acts on. Both stay cached under their own keys. */
  setTonWalletVersion(tonWalletVersion: TonWalletVersion): void {
    this.tonWalletVersion = tonWalletVersion
  }

  /**
   * Get address for specified chain
   * Uses CacheService with automatic persistent caching
   *
   * For TON, `options.tonWalletVersion` names a contract for this one lookup —
   * the way a migration screen shows the other account — without changing the
   * vault's selection; omitted, the lookup uses the selected contract (V4R2 unless
   * `setTonWalletVersion` said otherwise). Each contract's address is cached under
   * its own key so the two never alias.
   */
  async getAddress(chain: Chain, options: GetAddressOptions = {}): Promise<string> {
    assertValidChain(chain)
    const tonWalletVersion = chain === Chain.Ton ? (options.tonWalletVersion ?? this.tonWalletVersion) : undefined
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
