import { Buffer } from 'buffer'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { signatureFormats } from '@vultisig/core-chain/signing/SignatureFormat'
import { getTwPublicKeyType } from '@vultisig/core-chain/publicKey/tw/getTwPublicKeyType'
import { match } from '@vultisig/lib-utils/match'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import base58 from 'bs58'

import { KeysignSignature } from '../../../../keysign/KeysignSignature'
import { getEncodedSigningInputs } from '../../../../keysign/signingInputs'
import { spliceSolanaSignature } from '../../../../keysign/signingInputs/resolvers/solana/rawTx'
import { getKeysignTwPublicKey } from '../../../../keysign/tw/getKeysignTwPublicKey'
import { getKeysignChain } from '../../../../keysign/utils/getKeysignChain'
import { KeysignPayload } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'
import { compileSignBitcoinTx } from '../../../../tx/compile/compileSignBitcoinTx'
import { getPreSigningHashes } from '../../../../tx/preSigningHashes'

type Input = {
  payload: KeysignPayload
  walletCore: WalletCore
}

export const getCompiledTxsForBlockaidInput = async ({ payload, walletCore }: Input) => {
  const chain = getKeysignChain(payload)
  const chainKind = getChainKind(chain)

  const publicKeyData = getKeysignTwPublicKey(payload)
  const publicKey = walletCore.PublicKey.createWithData(publicKeyData, getTwPublicKeyType({ walletCore, chain }))

  const coinType = getCoinType({
    chain,
    walletCore,
  })

  if (payload.signData.case === 'signBitcoin') {
    const privateKey = walletCore.PrivateKey.create()
    const signatures = getPreSigningHashes({
      walletCore,
      txInputData: new Uint8Array(),
      chain,
      keysignPayload: payload,
    }).reduce<Record<string, KeysignSignature>>((result, msg) => {
      const msgHex = Buffer.from(msg).toString('hex')
      result[msgHex] = {
        msg: msgHex,
        r: '',
        s: '',
        der_signature: Buffer.from(privateKey.signAsDER(msg)).toString('hex'),
      }
      return result
    }, {})

    return [compileSignBitcoinTx(payload.signData.value, signatures, publicKey)]
  }

  const inputs = await getEncodedSigningInputs({
    keysignPayload: payload,
    walletCore,
    publicKey,
  })

  return inputs.map(txInputData => {
    // dApp-supplied raw Solana transaction (sdk#1204): txInputData is the
    // ORIGINAL serialized transaction, not a TW SigningInput — WalletCore's
    // TransactionCompiler can't consume it. The zero-signature scan preview
    // is the original bytes with a zeroed fee-payer signature slot, wrapped
    // in the same SigningOutput shape (base58 encoded) the consumers decode.
    if (chainKind === 'solana' && payload.signData.case === 'signSolana') {
      const zeroSigned = spliceSolanaSignature(txInputData, new Uint8Array(64))
      return TW.Solana.Proto.SigningOutput.encode(
        TW.Solana.Proto.SigningOutput.create({ encoded: base58.encode(zeroSigned) })
      ).finish()
    }

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

    return walletCore.TransactionCompiler.compileWithSignatures(coinType, txInputData, signatures, publicKeys)
  })
}
