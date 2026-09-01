import { PublicKey, WalletCore } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { defaultTonWalletVersion, deriveTonAddress, TonWalletVersion } from '@vultisig/core-chain/chains/ton/wallet'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'

import { deriveBittensorAddress } from './bittensor'
import { deriveCardanoAddress } from './cardano'

type DeriveAddressInput = {
  chain: Chain
  publicKey: PublicKey
  walletCore: WalletCore
  /**
   * TON only: which wallet contract to derive for. Defaults to V4R2, the
   * contract every existing Vultisig TON address uses; W5 is a different
   * account for the same key and must be an explicit choice.
   */
  tonWalletVersion?: TonWalletVersion
}

const bitcoinCashPrefix = 'bitcoincash:'

export const deriveAddress = ({ chain, publicKey, walletCore, tonWalletVersion }: DeriveAddressInput) => {
  if (chain === Chain.Ton) {
    return deriveTonAddress({ publicKey, walletCore, version: tonWalletVersion ?? defaultTonWalletVersion })
  }

  const coinType = getCoinType({
    chain,
    walletCore,
  })

  if (chain === Chain.MayaChain) {
    return walletCore.AnyAddress.createBech32WithPublicKey(publicKey, coinType, 'maya').description()
  }

  if (chain === Chain.Cardano) {
    return deriveCardanoAddress({
      publicKey,
      walletCore,
    })
  }

  if (chain === Chain.Bittensor) {
    return deriveBittensorAddress({
      publicKey,
      walletCore,
    })
  }

  const address = walletCore.CoinTypeExt.deriveAddressFromPublicKey(coinType, publicKey)

  if (chain === Chain.BitcoinCash && address.startsWith(bitcoinCashPrefix)) {
    return address.slice(bitcoinCashPrefix.length)
  }

  return address
}
