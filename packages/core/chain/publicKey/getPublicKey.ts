import { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { signatureAlgorithms } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import { match } from '@vultisig/lib-utils/match'

import { getCardanoPublicKeyData } from './cardano'
import { derivePublicKey } from './ecdsa/derivePublicKey'
import { PublicKeys } from './PublicKeys'
import { getTwPublicKeyType } from './tw/getTwPublicKeyType'

type Input = {
  chain: Chain
  walletCore: WalletCore
  hexChainCode: string
  publicKeys: PublicKeys
  chainPublicKeys?: Partial<Record<Chain, string>>
}

export const getPublicKey = ({ chain, walletCore, hexChainCode, publicKeys, chainPublicKeys }: Input) => {
  if (chain === Chain.QBTC) {
    throw new Error('QBTC uses MLDSA; use vault.publicKeyMldsa and deriveQbtcAddress instead of WalletCore public keys')
  }

  const coinType = getCoinType({
    walletCore,
    chain,
  })

  const chainPublicKey = chainPublicKeys?.[chain]

  if (chainPublicKeys !== undefined && Object.keys(chainPublicKeys).length > 0 && !chainPublicKey) {
    throw new Error('Chain public key not found')
  }

  const keysignType = signatureAlgorithms[getChainKind(chain)]

  const publicKeyType = getTwPublicKeyType({ walletCore, chain })

  // Derive via ECDSA BIP32 path (shared by the ecdsa branch and the
  // 32-byte-chainPublicKey fallback below).
  const deriveEcdsaPublicKey = (): string => {
    const path = walletCore.CoinTypeExt.derivationPath(coinType)
    if (!path) {
      throw new Error(`WalletCore returned empty derivation path (chain=${chain}, coinType=${coinType})`)
    }
    return derivePublicKey({ hexRootPubKey: publicKeys.ecdsa, hexChainCode, path })
  }

  let derivedPublicKey =
    chainPublicKey ??
    match(keysignType, {
      ecdsa: deriveEcdsaPublicKey,
      eddsa: () => publicKeys.eddsa,
      mldsa: () => {
        throw new Error('MLDSA public key is not derived via ECDSA/EdDSA paths')
      },
    })

  // Some vault backup formats (older KeyImport vaults) store the raw 32-byte
  // X coordinate for secp256k1 chains instead of the standard 33-byte
  // compressed form. WalletCore's createWithData rejects 32-byte ECDSA keys
  // ("Invalid length: Expected 33 but received 32"). Detect this case and
  // fall back to BIP32 derivation from the root ECDSA key, which always
  // produces a 33-byte compressed key. EdDSA keys are legitimately 32 bytes
  // so guard by keysignType.
  if (
    chainPublicKey !== undefined &&
    keysignType === 'ecdsa' &&
    Buffer.from(derivedPublicKey, 'hex').length === 32 &&
    publicKeys.ecdsa
  ) {
    derivedPublicKey = deriveEcdsaPublicKey()
  }

  const publicKeyData =
    chain === Chain.Cardano
      ? getCardanoPublicKeyData({
          publicKey: derivedPublicKey,
          hexChainCode,
        })
      : Buffer.from(derivedPublicKey, 'hex')

  const pubkey = walletCore.PublicKey.createWithData(publicKeyData, publicKeyType)

  if (coinType == walletCore.CoinType.tron) {
    return pubkey.uncompressed()
  }

  return pubkey
}
