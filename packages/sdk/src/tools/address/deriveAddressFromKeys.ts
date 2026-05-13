import { Chain } from '@vultisig/core-chain/Chain'
import { deriveAddress } from '@vultisig/core-chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'

import { getWalletCore } from '../../context/wasmRuntime'

type DeriveAddressFromKeysInput = {
  chain: Chain
  ecdsaPublicKey?: string
  eddsaPublicKey?: string
  hexChainCode: string
  /**
   * Optional map of pre-derived hardened pubkeys keyed by chain name (e.g. `{ Terra: '03c7...' }`).
   * When present for the requested chain, the derivation BIP32 re-walk is skipped and this pubkey
   * is used directly — enabling correct addresses for hardened-only chains like Terra/TerraClassic
   * in contexts where only the root pubkey + chain code are available (MCP / agent-backend).
   *
   * `Terra` is automatically aliased to `TerraClassic` (both share BIP44 coin_type 330).
   *
   * When absent or when the map does not contain an entry for the requested chain, the existing
   * non-hardened BIP32 fallback is used unchanged — existing callers are unaffected.
   */
  chainPublicKeys?: Partial<Record<Chain, string>>
}

type DeriveAddressFromKeysResult = {
  chain: Chain
  address: string
}

/**
 * Derive a wallet address for a chain from raw ECDSA/EdDSA public keys and chain code.
 * This is the vault-free equivalent of vault.getAddress() - useful for MCP servers
 * that store raw public keys without a full vault instance.
 *
 * @example
 * ```ts
 * const result = await deriveAddressFromKeys({
 *   chain: 'Ethereum',
 *   ecdsaPublicKey: '02abc...',
 *   eddsaPublicKey: 'def...',
 *   hexChainCode: '123...',
 * })
 * // => { chain: 'Ethereum', address: '0x...' }
 * ```
 */
export const deriveAddressFromKeys = async (
  input: DeriveAddressFromKeysInput
): Promise<DeriveAddressFromKeysResult> => {
  if (!input.ecdsaPublicKey && !input.eddsaPublicKey) {
    throw new Error('At least one public key (ecdsaPublicKey or eddsaPublicKey) is required')
  }
  if (!input.hexChainCode) {
    throw new Error('hexChainCode is required for address derivation')
  }

  let walletCore: Awaited<ReturnType<typeof getWalletCore>>
  try {
    walletCore = await getWalletCore()
  } catch (err) {
    throw new Error(
      `Failed to initialize WalletCore for address derivation: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // Terra and TerraClassic share BIP44 coin_type 330 and the same hardened-derived pubkey.
  // Mirror the alias from addressDerivation.ts so callers only need to supply one direction.
  // We also filter the map to only include the requested chain: getPublicKey treats any
  // non-empty map as authoritative and throws "Chain public key not found" when the chain
  // is absent, so we must not forward a partial map for an unrelated chain.
  const resolvedChainPublicKeys: Partial<Record<Chain, string>> | undefined = (() => {
    const keys = input.chainPublicKeys
    if (!keys) return undefined

    // Apply bidirectional Terra ↔ TerraClassic alias (same coin_type 330).
    const aliased: Partial<Record<Chain, string>> = { ...keys }
    if (aliased[Chain.Terra] && !(Chain.TerraClassic in aliased)) {
      aliased[Chain.TerraClassic] = aliased[Chain.Terra]
    } else if (aliased[Chain.TerraClassic] && !(Chain.Terra in aliased)) {
      aliased[Chain.Terra] = aliased[Chain.TerraClassic]
    }

    // Only forward the map when the requested chain has an entry.
    // When absent, let getPublicKey run its normal non-hardened BIP32 derivation.
    if (!(input.chain in aliased)) return undefined

    // An explicitly empty pubkey is a caller error — fail fast rather than silently
    // falling back to non-hardened derivation, which would produce the wrong address.
    if (!aliased[input.chain]?.trim()) {
      throw new Error(`Invalid chainPublicKeys entry for ${input.chain}: pubkey must be non-empty`)
    }

    return aliased
  })()

  let publicKey: ReturnType<typeof getPublicKey>
  try {
    publicKey = getPublicKey({
      chain: input.chain,
      walletCore,
      hexChainCode: input.hexChainCode,
      publicKeys: {
        ecdsa: input.ecdsaPublicKey ?? '',
        eddsa: input.eddsaPublicKey ?? '',
      },
      chainPublicKeys: resolvedChainPublicKeys,
    })
  } catch (err) {
    throw new Error(
      `Failed to derive public key for ${input.chain}: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  try {
    const address = deriveAddress({
      chain: input.chain,
      publicKey,
      walletCore,
    })

    return { chain: input.chain, address }
  } catch (err) {
    throw new Error(`Failed to derive address for ${input.chain}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
