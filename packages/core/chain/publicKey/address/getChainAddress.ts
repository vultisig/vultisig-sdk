import { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { TonWalletVersion } from '@vultisig/core-chain/chains/ton/wallet'
import { deriveAddress } from '@vultisig/core-chain/publicKey/address/deriveAddress'
import { deriveQbtcAddress } from '@vultisig/core-chain/publicKey/address/deriveQbtcAddress'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import { PublicKeys } from '@vultisig/core-chain/publicKey/PublicKeys'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

type GetChainAddressInput = {
  chain: Chain
  walletCore: WalletCore
  hexChainCode: string
  publicKeys: PublicKeys
  publicKeyMldsa?: string
  chainPublicKeys?: Partial<Record<Chain, string>>
  /** TON only: wallet contract to derive for. Defaults to V4R2. */
  tonWalletVersion?: TonWalletVersion
}

/** Derives the on-chain address for any chain, including MLDSA-based chains like QBTC. */
export const getChainAddress = ({
  chain,
  walletCore,
  hexChainCode,
  publicKeys,
  publicKeyMldsa,
  chainPublicKeys,
  tonWalletVersion,
}: GetChainAddressInput): string => {
  if (chain === Chain.QBTC) {
    return deriveQbtcAddress(shouldBePresent(publicKeyMldsa, 'MLDSA public key'))
  }

  const publicKey = getPublicKey({
    chain,
    walletCore,
    hexChainCode,
    publicKeys,
    chainPublicKeys,
  })

  return deriveAddress({ chain, publicKey, walletCore, tonWalletVersion })
}
