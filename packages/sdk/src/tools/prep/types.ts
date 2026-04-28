import type { Chain } from '@vultisig/core-chain/Chain'
import type { KeysignLibType } from '@vultisig/core-mpc/mpcLib'
import type { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'

/**
 * Vault identity fields required to build an unsigned KeysignPayload
 * without a full vault instance.
 *
 * Used by the vault-free `prepare*FromKeys` functions in this directory.
 * Mirrors the subset of `Vault` fields that participate in payload construction
 * (no key shares, no signing material — the security boundary is preserved).
 *
 * `localPartyId` is required — it is written to `keysignPayload.vaultLocalPartyId`
 * and downstream MPC participants may match strictly. Callers must pass the same
 * value the signing devices were registered with.
 */
export type VaultIdentity = {
  ecdsaPublicKey: string
  eddsaPublicKey: string
  hexChainCode: string
  localPartyId: string
  libType: KeysignLibType
  publicKeyMldsa?: string
  chainPublicKeys?: Partial<Record<Chain, string>>
}

/**
 * Map a full `Vault` into the slim `VaultIdentity` view used by vault-free prep
 * helpers. Used by `VaultBase` wrappers to delegate to the new public surface
 * without rewriting their call sites.
 */
export const vaultDataToIdentity = (vault: CoreVault): VaultIdentity => ({
  ecdsaPublicKey: vault.publicKeys.ecdsa,
  eddsaPublicKey: vault.publicKeys.eddsa,
  hexChainCode: vault.hexChainCode,
  localPartyId: vault.localPartyId,
  libType: vault.libType,
  publicKeyMldsa: vault.publicKeyMldsa,
  chainPublicKeys: vault.chainPublicKeys,
})
