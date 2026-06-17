import { Buffer } from 'buffer'
import { sha256 } from '@noble/hashes/sha256'

import { concatBytes, protoBytes, protoString, protoVarint } from '@vultisig/core-chain/chains/cosmos/protoEncoding'

const pubKeyTypeURL = '/cosmos.crypto.mldsa.PubKey'
const chainID = 'qbtc-testnet'
const claimGasLimit = 300_000n

type ClaimTxComponents = {
  bodyBytes: Uint8Array
  authInfoBytes: Uint8Array
}

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
  const authInfoBytes = buildClaimAuthInfo({ mldsaPublicKey, sequence })
  const signDoc = buildClaimSignDoc({
    bodyBytes,
    authInfoBytes,
    accountNumber,
  })

  return { hash: sha256(signDoc), authInfoBytes }
}

type ClaimSignedTransactionInput = ClaimTxComponents & {
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
  const txRaw = buildTxRaw({ bodyBytes, authInfoBytes, signature })

  return {
    txBytesBase64: Buffer.from(txRaw).toString('base64'),
    txHash: Buffer.from(sha256(txRaw)).toString('hex').toUpperCase(),
  }
}

type BuildClaimAuthInfoInput = {
  mldsaPublicKey: Uint8Array
  sequence: bigint
}

const buildClaimAuthInfo = ({ mldsaPublicKey, sequence }: BuildClaimAuthInfoInput): Uint8Array => {
  const pubKeyMsg = protoBytes(1, mldsaPublicKey)
  const pubKeyAny = concatBytes(protoString(1, pubKeyTypeURL), protoBytes(2, pubKeyMsg))
  const singleMode = protoVarint(1, 1n)
  const modeInfo = protoBytes(1, singleMode)
  const signerInfo = concatBytes(protoBytes(1, pubKeyAny), protoBytes(2, modeInfo), protoVarint(3, sequence))
  const fee = protoBytes(2, protoVarint(2, claimGasLimit))

  return concatBytes(protoBytes(1, signerInfo), fee)
}

type BuildClaimSignDocInput = ClaimTxComponents & {
  accountNumber: bigint
}

const buildClaimSignDoc = ({ bodyBytes, authInfoBytes, accountNumber }: BuildClaimSignDocInput): Uint8Array =>
  concatBytes(
    protoBytes(1, bodyBytes),
    protoBytes(2, authInfoBytes),
    protoString(3, chainID),
    protoVarint(4, accountNumber)
  )

type BuildTxRawInput = ClaimTxComponents & {
  signature: Uint8Array
}

const buildTxRaw = ({ bodyBytes, authInfoBytes, signature }: BuildTxRawInput): Uint8Array =>
  concatBytes(protoBytes(1, bodyBytes), protoBytes(2, authInfoBytes), protoBytes(3, signature))
