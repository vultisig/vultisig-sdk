import { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { TonWalletVersion } from '@vultisig/core-chain/chains/ton/wallet'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { getSignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import { match } from '@vultisig/lib-utils/match'

import { getChainAddress } from './getChainAddress'

type GetChainPublicKeyHexInput = {
  chain: Chain
  mnemonic: string
  walletCore: WalletCore
}

// Only uses the HDWallet and PrivateKey calls React Native's WalletCore bridge implements.
const getChainPublicKeyHex = ({ chain, mnemonic, walletCore }: GetChainPublicKeyHexInput): string => {
  const hdWallet = walletCore.HDWallet.createWithMnemonic(mnemonic, '')
  try {
    const privateKey = hdWallet.getKeyForCoin(getCoinType({ chain, walletCore }))
    try {
      const publicKey = match(getSignatureAlgorithm(chain), {
        ecdsa: () => privateKey.getPublicKeySecp256k1(true),
        eddsa: () => privateKey.getPublicKeyEd25519(),
        mldsa: () => {
          throw new Error(`${chain} uses MLDSA; its key cannot be derived from a seedphrase`)
        },
      })
      try {
        return Buffer.from(publicKey.data()).toString('hex')
      } finally {
        publicKey.delete()
      }
    } finally {
      privateKey.delete()
    }
  } finally {
    hdWallet.delete()
  }
}

type DeriveAddressFromMnemonicInput = GetChainPublicKeyHexInput & {
  /** TON only: wallet contract to derive for, as when the vault's coins are created. Defaults to V4R2. */
  tonWalletVersion?: TonWalletVersion
}

/**
 * Derives the address a seedphrase-imported vault will have on `chain`. Takes
 * the chain key that key import stores in `chainPublicKeys` and runs it
 * through `getChainAddress`, the derivation every vault address goes through.
 */
export const deriveAddressFromMnemonic = ({
  chain,
  mnemonic,
  walletCore,
  tonWalletVersion,
}: DeriveAddressFromMnemonicInput): string =>
  getChainAddress({
    chain,
    walletCore,
    hexChainCode: '',
    publicKeys: { ecdsa: '', eddsa: '' },
    chainPublicKeys: { [chain]: getChainPublicKeyHex({ chain, mnemonic, walletCore }) },
    tonWalletVersion,
  })
