import { fromBinary } from '@bufbuild/protobuf'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { assembleBittensorExtrinsic } from '@vultisig/core-chain/chains/bittensor/signing/buildExtrinsic'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { signatureFormats } from '@vultisig/core-chain/signing/SignatureFormat'
import { assertSignature } from '@vultisig/core-chain/utils/assertSignature'

import { getQBTCSignedTransaction } from '../../chains/cosmos/qbtc/QBTCHelper'
import { getBlockchainSpecificValue } from '../../keysign/chainSpecific/KeysignChainSpecific'
import { KeysignSignature } from '../../keysign/KeysignSignature'
import { decodeBittensorTxInput } from '../../keysign/signingInputs/resolvers/bittensor'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { getPreSigningHashes } from '../preSigningHashes'
import { generateSignature } from '../signature/generateSignature'

type Input = {
  publicKey: PublicKey
  txInputData: Uint8Array
  signatures: Record<string, KeysignSignature>
  chain: Chain
  walletCore: WalletCore
}

export const compileTx = ({
  publicKey,
  txInputData,
  signatures: keysignSignatures,
  chain,
  walletCore,
}: Input) => {
  if (chain === Chain.QBTC) {
    const keysignPayload = fromBinary(KeysignPayloadSchema, txInputData)
    const cosmosSpecific = getBlockchainSpecificValue(
      keysignPayload.blockchainSpecific,
      'cosmosSpecific'
    )
    const hashHexes = getPreSigningHashes({
      walletCore,
      txInputData,
      chain,
    }).map(h => Buffer.from(h).toString('hex'))
    const qbtcSignatures = Object.fromEntries(
      hashHexes.map(hex => [hex, keysignSignatures[hex]])
    )
    const { serialized } = getQBTCSignedTransaction({
      keysignPayload,
      cosmosSpecific,
      signatures: qbtcSignatures,
    })
    return TW.Cosmos.Proto.SigningOutput.encode(
      TW.Cosmos.Proto.SigningOutput.create({ serialized })
    ).finish()
  }

  const hashes = getPreSigningHashes({
    walletCore,
    txInputData,
    chain,
  })

  const chainKind = getChainKind(chain)
  const signatureFormat = signatureFormats[chainKind]

  if (chain === Chain.Bittensor) {
    const hash = hashes[0]
    const hashHex = Buffer.from(hash).toString('hex')

    const sig = generateSignature({
      walletCore,
      signature: keysignSignatures[hashHex],
      signatureFormat,
    })

    assertSignature({
      publicKey,
      message: hash,
      signature: sig,
      signatureFormat,
    })

    const { callData, signedExtra } = decodeBittensorTxInput(txInputData)
    const signerPubkey = new Uint8Array(publicKey.data())

    const extrinsic = assembleBittensorExtrinsic(
      signerPubkey,
      new Uint8Array(sig),
      callData,
      signedExtra
    )

    return TW.Polkadot.Proto.SigningOutput.encode(
      TW.Polkadot.Proto.SigningOutput.create({
        encoded: extrinsic,
      })
    ).finish()
  }

  const allSignatures = walletCore.DataVector.create()
  const publicKeys = walletCore.DataVector.create()

  hashes.forEach(hash => {
    const signature = generateSignature({
      walletCore,
      signature: keysignSignatures[Buffer.from(hash).toString('hex')],
      signatureFormat,
    })

    assertSignature({
      publicKey,
      message: hash,
      signature,
      signatureFormat,
    })

    allSignatures.add(signature)

    if (chainKind !== 'evm') {
      publicKeys.add(publicKey.data())
    }
  })

  const coinType = getCoinType({
    chain,
    walletCore,
  })

  return walletCore.TransactionCompiler.compileWithSignatures(
    coinType,
    txInputData,
    allSignatures,
    publicKeys
  )
}
