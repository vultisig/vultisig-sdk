import { Buffer } from 'buffer'
import { fromBinary } from '@bufbuild/protobuf'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import base58 from 'bs58'

import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { assembleBittensorExtrinsic } from '@vultisig/core-chain/chains/bittensor/signing/buildExtrinsic'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { signatureFormats } from '@vultisig/core-chain/signing/SignatureFormat'
import { assertSignature } from '@vultisig/core-chain/utils/assertSignature'

import { getQBTCSignedTransaction } from '../../chains/cosmos/qbtc/QBTCHelper'
import { buildCip20AuxData } from './cardano/buildCip20AuxData'
import { buildSignedCardanoTx } from './cardano/buildSignedCardanoTx'
import { getBlockchainSpecificValue } from '../../keysign/chainSpecific/KeysignChainSpecific'
import { KeysignSignature } from '../../keysign/KeysignSignature'
import { decodeBittensorTxInput } from '../../keysign/signingInputs/resolvers/bittensor'
import { spliceSolanaSignature } from '../../keysign/signingInputs/resolvers/solana/rawTx'
import { KeysignPayload, KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { getPreSigningHashes } from '../preSigningHashes'
import { generateSignature } from '../signature/generateSignature'
import { getSwapKitSignBitcoin } from '../swapkitSignBitcoin'
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
  const signBitcoin = keysignPayload ? getSwapKitSignBitcoin(keysignPayload) : undefined

  // PSBT signing: build raw signed tx from SignBitcoin fields + MPC signatures
  if (signBitcoin) {
    if (!publicKey) {
      throw new Error('publicKey is required for SignBitcoin compilation')
    }
    return compileSignBitcoinTx(signBitcoin, keysignSignatures, publicKey)
  }

  if (chain === Chain.QBTC) {
    const qbtcPayload = fromBinary(KeysignPayloadSchema, txInputData)
    const cosmosSpecific = getBlockchainSpecificValue(qbtcPayload.blockchainSpecific, 'cosmosSpecific')
    const hashHexes = getPreSigningHashes({
      walletCore,
      txInputData,
      chain,
    }).map(h => Buffer.from(h).toString('hex'))
    const qbtcSignatures = Object.fromEntries(hashHexes.map(hex => [hex, keysignSignatures[hex]]))
    const { serialized } = getQBTCSignedTransaction({
      keysignPayload: qbtcPayload,
      cosmosSpecific,
      signatures: qbtcSignatures,
    })
    return TW.Cosmos.Proto.SigningOutput.encode(TW.Cosmos.Proto.SigningOutput.create({ serialized })).finish()
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

  // dApp-supplied raw Solana transaction (sdk#1204): txInputData is the
  // ORIGINAL serialized transaction and hashes[0] is its wire-format message
  // (see getPreSigningHashes). Splice the 64-byte signature into the original
  // bytes at signer index 0 instead of letting TransactionCompiler assemble
  // from a WalletCore re-encode that may not match what was signed
  // (ios#4419 / android#5223 parity).
  if (chainKind === 'solana' && keysignPayload?.signData.case === 'signSolana') {
    const message = hashes[0]

    const signature = generateSignature({
      walletCore,
      signature: keysignSignatures[Buffer.from(message).toString('hex')],
      signatureFormat,
    })

    assertSignature({
      publicKey,
      message,
      signature,
      signatureFormat,
    })

    const signedTx = spliceSolanaSignature(txInputData, new Uint8Array(signature))

    return TW.Solana.Proto.SigningOutput.encode(
      TW.Solana.Proto.SigningOutput.create({
        // WalletCore's Solana SigningOutput.encoded is base58 — the broadcast
        // resolver (`broadcastSolanaTx`) and Blockaid inputs decode it as such.
        encoded: base58.encode(signedTx),
      })
    ).finish()
  }

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

    const extrinsic = assembleBittensorExtrinsic(signerPubkey, new Uint8Array(sig), callData, signedExtra)

    return TW.Polkadot.Proto.SigningOutput.encode(
      TW.Polkadot.Proto.SigningOutput.create({
        encoded: extrinsic,
      })
    ).finish()
  }

  if (chain === Chain.Cardano) {
    // hashes[0] is blake2b-256 of the tx body. When a memo is set, WalletCore
    // already committed the aux_data_hash into the body (key 7) from
    // SigningInput.auxiliary_data, so the signing and compile phases agree on
    // the same bytes without any client-side patching.
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

    // Re-derive the tx body to wrap it with the witness set. WalletCore already
    // committed the aux_data_hash into this body when a memo was set, so it is
    // used as-is; the matching aux-data bytes go into element [3] of the tx.
    const preOutput = TW.TxCompiler.Proto.PreSigningOutput.decode(
      walletCore.TransactionCompiler.preImageHashes(getCoinType({ chain, walletCore }), txInputData)
    )

    const memo = keysignPayload?.memo
    const txBodyCbor = preOutput.data
    const auxDataCbor = memo ? buildCip20AuxData(memo).auxDataCbor : undefined

    const spendingKey = new Uint8Array(publicKey.data()).slice(0, 32)
    const encoded = buildSignedCardanoTx({
      txBodyCbor,
      publicKey: spendingKey,
      signature: new Uint8Array(sig),
      auxDataCbor,
    })

    return TW.Cardano.Proto.SigningOutput.encode(
      TW.Cardano.Proto.SigningOutput.create({
        encoded,
        // hashes[0] is blake2b-256 of the body — correct txId for both paths
        txId: hash,
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

  return walletCore.TransactionCompiler.compileWithSignatures(coinType, txInputData, allSignatures, publicKeys)
}
