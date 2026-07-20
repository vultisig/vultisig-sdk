import { concatBytes, protoBytes, protoString, protoVarint } from '@vultisig/core-chain/chains/cosmos/protoEncoding'

const pubKeyTypeURL = '/cosmos.crypto.mldsa.PubKey'
const defaultGasLimit = 300_000n

export const qbtcChainID = 'qbtc'

export type QBTCTxComponents = {
  bodyBytes: Uint8Array
  authInfoBytes: Uint8Array
}

type BuildQBTCAuthInfoInput = {
  pubKeyData: Uint8Array
  sequence: bigint
  gasLimit?: bigint
  fee?: {
    denom: string
    amount: string
  }
}

export const buildQBTCAuthInfo = ({ pubKeyData, sequence, gasLimit, fee }: BuildQBTCAuthInfoInput): Uint8Array => {
  const pubKeyMsg = protoBytes(1, pubKeyData)
  const pubKeyAny = concatBytes(protoString(1, pubKeyTypeURL), protoBytes(2, pubKeyMsg))
  const singleMode = protoVarint(1, 1n)
  const modeInfo = protoBytes(1, singleMode)
  const signerInfo = concatBytes(protoBytes(1, pubKeyAny), protoBytes(2, modeInfo), protoVarint(3, sequence))
  const feeCoin = fee
    ? protoBytes(1, concatBytes(protoString(1, fee.denom), protoString(2, fee.amount)))
    : new Uint8Array(0)
  // Proto field 7 is `optional uint64`: an unset limit arrives as `undefined`, but a producer could
  // also relay a nonsensical 0n (or negative). Both must fall back to the static default - NOT flow
  // through as-is, because `protoVarint(2, 0n)` elides the field entirely (proto3 default-elision),
  // which would omit gas_limit and sign an invalid zero-gas tx. Mirrors resolveCosmosGasFee's
  // `relayedGasLimit && relayedGasLimit > 0n` guard so QBTC and standard cosmos treat 0/unset alike.
  const effectiveGasLimit = gasLimit && gasLimit > 0n ? gasLimit : defaultGasLimit
  const feeBytes = concatBytes(feeCoin, protoVarint(2, effectiveGasLimit))

  return concatBytes(protoBytes(1, signerInfo), protoBytes(2, feeBytes))
}

type BuildQBTCSignDocFromComponentsInput = QBTCTxComponents & {
  accountNumber: bigint
  chainID?: string
}

export const buildQBTCSignDocFromComponents = ({
  bodyBytes,
  authInfoBytes,
  accountNumber,
  chainID = qbtcChainID,
}: BuildQBTCSignDocFromComponentsInput) =>
  concatBytes(
    protoBytes(1, bodyBytes),
    protoBytes(2, authInfoBytes),
    protoString(3, chainID),
    protoVarint(4, accountNumber)
  )

type BuildQBTCTxRawInput = QBTCTxComponents & {
  signature: Uint8Array
}

export const buildQBTCTxRaw = ({ bodyBytes, authInfoBytes, signature }: BuildQBTCTxRawInput): Uint8Array =>
  concatBytes(protoBytes(1, bodyBytes), protoBytes(2, authInfoBytes), protoBytes(3, signature))
