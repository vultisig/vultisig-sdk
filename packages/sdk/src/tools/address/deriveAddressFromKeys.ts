import { Chain } from '@vultisig/core-chain/Chain'
import { deriveAddress } from '@vultisig/core-chain/publicKey/address/deriveAddress'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'

import { getWalletCore } from '../../context/wasmRuntime'

type DeriveAddressFromKeysInput = {
  chain: Chain
  ecdsaPublicKey: string
  eddsaPublicKey: string
  hexChainCode: string
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

  let publicKey: ReturnType<typeof getPublicKey>
  try {
    publicKey = getPublicKey({
      chain: input.chain,
      walletCore,
      hexChainCode: input.hexChainCode,
      publicKeys: {
        ecdsa: input.ecdsaPublicKey,
        eddsa: input.eddsaPublicKey,
      },
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
