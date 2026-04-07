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
  const walletCore = await getWalletCore()

  const publicKey = getPublicKey({
    chain: input.chain,
    walletCore,
    hexChainCode: input.hexChainCode,
    publicKeys: {
      ecdsa: input.ecdsaPublicKey,
      eddsa: input.eddsaPublicKey,
    },
  })

  const address = deriveAddress({
    chain: input.chain,
    publicKey,
    walletCore,
  })

  return { chain: input.chain, address }
}
