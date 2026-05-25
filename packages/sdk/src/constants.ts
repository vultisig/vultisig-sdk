/**
 * SDK Constants
 * Shared constants to avoid circular dependencies
 */

import { Chain, defaultChains } from '@vultisig/core-chain/Chain'

import { VaultError, VaultErrorCode } from './vault/VaultError'

/**
 * Default chains for new vaults
 * Re-exported from core for backward compatibility
 */
export const DEFAULT_CHAINS: Chain[] = defaultChains

/**
 * All supported chains (from Chain enum)
 */
export const SUPPORTED_CHAINS: Chain[] = Object.values(Chain)

/**
 * Chains intentionally hidden from seedphrase import until their key material
 * and signing paths are fully supported end-to-end.
 */
export const SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS: Chain[] = [Chain.Cardano, Chain.QBTC, Chain.Bittensor]

const unsupportedSeedphraseImportChains = new Set<Chain>(SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS)

/**
 * Chains that can be safely imported from a BIP39 seedphrase.
 */
export const SEEDPHRASE_IMPORT_SUPPORTED_CHAINS: Chain[] = SUPPORTED_CHAINS.filter(
  chain => !unsupportedSeedphraseImportChains.has(chain)
)

export const isSeedphraseImportSupportedChain = (chain: Chain): boolean => !unsupportedSeedphraseImportChains.has(chain)

export const getUnsupportedSeedphraseImportChains = (chains: readonly Chain[]): Chain[] =>
  chains.filter(chain => !isSeedphraseImportSupportedChain(chain))

export const assertSeedphraseImportSupportsChains = (chains: readonly Chain[]): void => {
  const unsupportedChains = getUnsupportedSeedphraseImportChains(chains)

  if (unsupportedChains.length === 0) {
    return
  }

  throw new VaultError(
    VaultErrorCode.InvalidConfig,
    `Seedphrase import does not currently support ${unsupportedChains.join(
      ', '
    )}. These chains require key material or threshold signing that is not available in the current SDK.`
  )
}
