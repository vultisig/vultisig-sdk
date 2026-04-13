import {
  concatBytes,
  protoBytes,
  protoString,
  protoVarint,
} from '@vultisig/core-chain/chains/cosmos/qbtc/protoEncoding'

const msgClaimWithProofTypeURL = '/qbtc.qbtc.v1.MsgClaimWithProof'

type UtxoRef = {
  txid: string
  vout: number
}

type BuildMsgClaimWithProofInput = {
  /** QBTC bech32 address of the claimer. */
  claimer: string
  /** UTXOs to include in the claim (1-50, no duplicates). */
  utxos: UtxoRef[]
  /** Hex-encoded PLONK ZK proof. */
  proof: string
  /** 64-char hex MessageHash. */
  messageHash: string
  /** 40-char hex AddressHash (Hash160). */
  addressHash: string
  /** 64-char hex QBTCAddressHash. */
  qbtcAddressHash: string
}

/** Validates the claim input against the chain's constraints (Section 5). */
export const validateClaimInput = (input: BuildMsgClaimWithProofInput) => {
  const { utxos, proof, messageHash, addressHash, qbtcAddressHash } = input

  if (utxos.length === 0 || utxos.length > 50) {
    throw new Error(`UTXOs count must be 1-50, got ${utxos.length}`)
  }

  const seen = new Set<string>()
  for (const { txid, vout } of utxos) {
    if (txid.length !== 64) {
      throw new Error(`Invalid txid length: expected 64, got ${txid.length}`)
    }
    const key = `${txid}:${vout}`
    if (seen.has(key)) {
      throw new Error(`Duplicate UTXO reference: ${key}`)
    }
    seen.add(key)
  }

  if (proof.length < 200) {
    throw new Error('Proof too small (min 100 bytes / 200 hex chars)')
  }
  if (proof.length > 100_000) {
    throw new Error('Proof too large (max 50 KB / 100000 hex chars)')
  }
  if (messageHash.length !== 64) {
    throw new Error(
      `message_hash must be 64 hex chars, got ${messageHash.length}`
    )
  }
  if (addressHash.length !== 40) {
    throw new Error(
      `address_hash must be 40 hex chars, got ${addressHash.length}`
    )
  }
  if (qbtcAddressHash.length !== 64) {
    throw new Error(
      `qbtc_address_hash must be 64 hex chars, got ${qbtcAddressHash.length}`
    )
  }
}

/** Encodes a single UTXORef as protobuf. */
const encodeUtxoRef = ({ txid, vout }: UtxoRef): Uint8Array =>
  concatBytes(protoString(1, txid), protoVarint(2, BigInt(vout)))

/** Encodes MsgClaimWithProof as protobuf bytes. */
const buildMsgClaimWithProof = (
  input: BuildMsgClaimWithProofInput
): Uint8Array => {
  const utxoBytes = input.utxos.map(utxo => protoBytes(2, encodeUtxoRef(utxo)))

  return concatBytes(
    protoString(1, input.claimer),
    ...utxoBytes,
    protoString(3, input.proof),
    protoString(4, input.messageHash),
    protoString(5, input.addressHash),
    protoString(6, input.qbtcAddressHash)
  )
}

/** Wraps MsgClaimWithProof in a Cosmos Any message. */
export const buildClaimWithProofAny = (
  input: BuildMsgClaimWithProofInput
): Uint8Array => {
  validateClaimInput(input)
  const msg = buildMsgClaimWithProof(input)
  return concatBytes(
    protoString(1, msgClaimWithProofTypeURL),
    protoBytes(2, msg)
  )
}

/** Builds the TxBody containing a single MsgClaimWithProof. */
export const buildClaimTxBody = (
  input: BuildMsgClaimWithProofInput
): Uint8Array => {
  const anyMsg = buildClaimWithProofAny(input)
  return protoBytes(1, anyMsg)
}
