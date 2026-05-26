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
  /**
   * Per-chain BIP32 path overrides.  An empty string (`""`) means "literal root":
   * use the ECDSA root public key directly with no BIP32 derivation.
   *
   * Required for Fast Vault MPC recovery wallets whose keysign session was
   * executed at the root key (no derivation hop), producing an address of the
   * form `bech32(prefix, hash160(ecdsaRootPubKey))`.
   *
   * Behaviour:
   * - `""` → the root `ecdsaPublicKey` is injected as a synthetic `chainPublicKeys`
   *   entry for the requested chain, bypassing BIP32 derivation entirely.
   * - Non-empty strings are reserved for future path-override support and are
   *   currently ignored (the standard derivation path is used).
   * - Takes precedence over `chainPublicKeys` for the same chain when both are
   *   provided (the synthetic injection wins).
   */
  derivationOverrides?: Partial<Record<Chain, string>>
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

  // Resolve derivationOverrides: an empty-string override means "literal root" —
  // use the ECDSA root pubkey directly with no BIP32 derivation hop.
  // We implement this by injecting a synthetic chainPublicKeys entry so the
  // existing chainPublicKeys path handles the bypass transparently.
  // derivationOverrides takes precedence over chainPublicKeys for the same chain.
  const effectiveChainPublicKeys: Partial<Record<Chain, string>> | undefined = (() => {
    // Determine if a literal-root override applies for the requested chain.
    // The override map may key on either the exact chain OR its Terra/TerraClassic alias.
    const directOverride = input.derivationOverrides?.[input.chain]
    const aliasOverride =
      input.chain === Chain.TerraClassic
        ? input.derivationOverrides?.[Chain.Terra]
        : input.chain === Chain.Terra
          ? input.derivationOverrides?.[Chain.TerraClassic]
          : undefined
    const activeOverride = directOverride ?? aliasOverride

    if (activeOverride === '') {
      // Literal-root override: use the ECDSA root key as the pre-derived pubkey.
      // ecdsaPublicKey is guaranteed non-empty by the guard at the top of this function.
      const rootKey = input.ecdsaPublicKey!
      const synthetic: Partial<Record<Chain, string>> = {
        ...input.chainPublicKeys,
        [input.chain]: rootKey,
      }
      return synthetic
    }
    // Non-empty override strings are reserved for future use; fall through to
    // standard chainPublicKeys resolution.
    return input.chainPublicKeys
  })()

  // Terra and TerraClassic share BIP44 coin_type 330 and the same hardened-derived pubkey.
  // Mirror the alias from addressDerivation.ts so callers only need to supply one direction.
  // We also filter the map to only include the requested chain: getPublicKey treats any
  // non-empty map as authoritative and throws "Chain public key not found" when the chain
  // is absent, so we must not forward a partial map for an unrelated chain.
  const resolvedChainPublicKeys: Partial<Record<Chain, string>> | undefined = (() => {
    const keys = effectiveChainPublicKeys
    if (!keys) return undefined

    // Validate all present entries before any alias logic.
    // An explicitly empty pubkey is a caller error — fail fast rather than silently
    // falling back to non-hardened derivation, which would produce the wrong address.
    // This must happen before alias expansion so that e.g. { Terra: "" } while
    // requesting TerraClassic is caught here rather than silently bypassed.
    for (const [chain, pubkey] of Object.entries(keys) as [Chain, string][]) {
      if (pubkey !== undefined && !pubkey.trim()) {
        throw new Error(`Invalid chainPublicKeys entry for ${chain}: pubkey must be non-empty`)
      }
    }

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
