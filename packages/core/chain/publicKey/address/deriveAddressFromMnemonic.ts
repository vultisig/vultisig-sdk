import { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'

import { deriveAddress } from './deriveAddress'

type DeriveAddressFromMnemonicInput = {
  chain: Chain
  mnemonic: string
  walletCore: WalletCore
}

/**
 * Derives the address a seedphrase-imported vault will have on `chain`.
 * Chains that share a WalletCore coin type (MayaChain on THORChain's,
 * Bittensor on Polkadot's) need their own address format, so the key is
 * run through `deriveAddress` instead of `HDWallet.getAddressForCoin`.
 */
export const deriveAddressFromMnemonic = ({ chain, mnemonic, walletCore }: DeriveAddressFromMnemonicInput): string => {
  const hdWallet = walletCore.HDWallet.createWithMnemonic(mnemonic, '')
  const coinType = getCoinType({ chain, walletCore })
  const privateKey = hdWallet.getKeyForCoin(coinType)
  const publicKey = privateKey.getPublicKey(coinType)

  try {
    return deriveAddress({ chain, publicKey, walletCore })
  } finally {
    publicKey.delete()
    privateKey.delete()
    hdWallet.delete()
  }
}
