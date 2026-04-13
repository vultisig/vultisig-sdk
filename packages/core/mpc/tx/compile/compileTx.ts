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
import { buildSignedCardanoTx } from './cardano/buildSignedCardanoTx'
import { getBlockchainSpecificValue } from '../../keysign/chainSpecific/KeysignChainSpecific'
import { KeysignSignature } from '../../keysign/KeysignSignature'
import { decodeBittensorTxInput } from '../../keysign/signingInputs/resolvers/bittensor'
import {
  KeysignPayload,
  KeysignPayloadSchema,
} from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { getPreSigningHashes } from '../preSigningHashes'
import { generateSignature } from '../signature/generateSignature'
import { compileSignBitcoinTx } from './compileSignBitcoinTx'

type Input = {
  publicKey?: PublicKey
  txInputData: Uint8Array
  signatures: Record<string, KeysignSignature>
  chain: Chain
  walletCore: WalletCore
  keysignPayload?: KeysignPayload
}

export const compileTx = ({
  publicKey,
  txInputData,
  signatures: keysignSignatures,
  chain,
  walletCore,
  keysignPayload,
}: Input) => {
  // PSBT signing: build raw signed tx from SignBitcoin fields + MPC signatures
  if (keysignPayload?.signData.case === 'signBitcoin') {
    if (!publicKey) {
      throw new Error('publicKey is required for SignBitcoin compilation')
    }
    return compileSignBitcoinTx(
      keysignPayload.signData.value,
      keysignSignatures,
      publicKey
    )
  }

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

  if (!publicKey) {
    throw new Error(`publicKey is required for ${chain} transaction compilation`)
  }

  const hashes = getPreSigningHashes({
    walletCore,
    txInputData,
    chain,
    keysignPayload,
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

  if (chain === Chain.Cardano) {
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

    // preOutput.data is the CBOR-encoded tx body
    const preOutput = TW.TxCompiler.Proto.PreSigningOutput.decode(
      walletCore.TransactionCompiler.preImageHashes(
        getCoinType({ chain, walletCore }),
        txInputData
      )
    )

    const spendingKey = new Uint8Array(publicKey.data()).slice(0, 32)
    const encoded = buildSignedCardanoTx({
      txBodyCbor: preOutput.data,
      publicKey: spendingKey,
      signature: new Uint8Array(sig),
    })

    return TW.Cardano.Proto.SigningOutput.encode(
      TW.Cardano.Proto.SigningOutput.create({
        encoded,
        // Embed the correct tx hash so downstream code doesn't need to
        // re-encode the body (cbor-x round-trip can alter bytes).
        txId: preOutput.dataHash,
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
