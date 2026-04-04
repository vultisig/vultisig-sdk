import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { signatureFormats } from '@vultisig/core-chain/signing/SignatureFormat'
import { getTwPublicKeyType } from '@vultisig/core-chain/publicKey/tw/getTwPublicKeyType'
import { match } from '@vultisig/lib-utils/match'
import { WalletCore } from '@trustwallet/wallet-core'

import { getEncodedSigningInputs } from '../../../../keysign/signingInputs'
import { getKeysignTwPublicKey } from '../../../../keysign/tw/getKeysignTwPublicKey'
import { getKeysignChain } from '../../../../keysign/utils/getKeysignChain'
import { KeysignPayload } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'
import { getPreSigningHashes } from '../../../../tx/preSigningHashes'

type Input = {
  payload: KeysignPayload
  walletCore: WalletCore
}

export const getCompiledTxsForBlockaidInput = ({
  payload,
  walletCore,
}: Input) => {
  const chain = getKeysignChain(payload)
  const chainKind = getChainKind(chain)

  const publicKeyData = getKeysignTwPublicKey(payload)
  const publicKey = walletCore.PublicKey.createWithData(
    publicKeyData,
    getTwPublicKeyType({ walletCore, chain })
  )

  const coinType = getCoinType({
    chain,
    walletCore,
  })

  const inputs = getEncodedSigningInputs({
    keysignPayload: payload,
    walletCore,
    publicKey,
  })

  return inputs.map(txInputData => {
    const preHashes = getPreSigningHashes({
      walletCore,
      txInputData,
      chain,
      keysignPayload: payload,
    })

    const signatures = walletCore.DataVector.create()
    const publicKeys = walletCore.DataVector.create()

    preHashes.forEach(msg =>
      match(signatureFormats[chainKind], {
        raw: () => {
          signatures.add(Buffer.alloc(64, 0))
          publicKeys.add(publicKey.data())
        },
        rawWithRecoveryId: () => {
          signatures.add(Buffer.alloc(65, 0))
          publicKeys.add(publicKey.data())
        },
        der: () => {
          const privateKey = walletCore.PrivateKey.create()

          signatures.add(Buffer.from(privateKey.signAsDER(msg)))
          publicKeys.add(privateKey.getPublicKeySecp256k1(true).data())
        },
      })
    )

    return walletCore.TransactionCompiler.compileWithSignatures(
      coinType,
      txInputData,
      signatures,
      publicKeys
    )
  })
}
