import { Buffer } from 'buffer'
import { sha256 } from '@noble/hashes/sha256'

import { buildQBTCAuthInfo, buildQBTCSignDocFromComponents, buildQBTCTxRaw, type QBTCTxComponents } from './QBTCTx'

type ClaimPreSignedImageHashInput = {
  bodyBytes: Uint8Array
  accountNumber: bigint
  mldsaPublicKey: Uint8Array
  sequence: bigint
}

export const getClaimPreSignedImageHash = ({
  bodyBytes,
  accountNumber,
  mldsaPublicKey,
  sequence,
}: ClaimPreSignedImageHashInput): {
  hash: Uint8Array
  authInfoBytes: Uint8Array
} => {
  const authInfoBytes = buildQBTCAuthInfo({
    pubKeyData: mldsaPublicKey,
    sequence,
  })
  const signDoc = buildQBTCSignDocFromComponents({
    bodyBytes,
    authInfoBytes,
    accountNumber,
  })

  return { hash: sha256(signDoc), authInfoBytes }
}

type ClaimSignedTransactionInput = QBTCTxComponents & {
  signature: Uint8Array
}

export const getClaimSignedTransaction = ({
  bodyBytes,
  authInfoBytes,
  signature,
}: ClaimSignedTransactionInput): {
  txBytesBase64: string
  txHash: string
} => {
  const txRaw = buildQBTCTxRaw({ bodyBytes, authInfoBytes, signature })

  return {
    txBytesBase64: Buffer.from(txRaw).toString('base64'),
    txHash: Buffer.from(sha256(txRaw)).toString('hex').toUpperCase(),
  }
}
