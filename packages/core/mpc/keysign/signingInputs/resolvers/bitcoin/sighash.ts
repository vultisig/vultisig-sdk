import { sha256 } from '@noble/hashes/sha256'

import { SignBitcoin } from '../../../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

// -- Shared serialization utilities --
// See https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki

/** Double-SHA256 as used in Bitcoin consensus. */
const hash256 = (data: Uint8Array): Buffer =>
  Buffer.from(sha256(sha256(data)))

/** Serialize a uint32 as 4 bytes little-endian. */
export const writeUInt32LE = (value: number): Buffer => {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(value)
  return buf
}

/** Serialize a uint64 as 8 bytes little-endian (Bitcoin amounts are unsigned). */
export const writeUInt64LE = (value: bigint): Buffer => {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(value)
  return buf
}

/** Encode an integer as a Bitcoin varint (CompactSize). */
export const writeVarInt = (n: number): Buffer => {
  if (n < 0xfd) {
    return Buffer.from([n])
  }
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3)
    buf[0] = 0xfd
    buf.writeUInt16LE(n, 1)
    return buf
  }
  const buf = Buffer.alloc(5)
  buf[0] = 0xfe
  buf.writeUInt32LE(n, 1)
  return buf
}

/**
 * Derive BIP-143 scriptCode from a P2WPKH scriptPubKey.
 * 0x0014<20-byte-hash> -> OP_DUP OP_HASH160 <20> <hash> OP_EQUALVERIFY OP_CHECKSIG
 * The 0x19 length prefix is part of the scriptCode per BIP-143.
 */
const p2wpkhScriptCode = (scriptPubKey: Buffer): Buffer => {
  const pubkeyHash = scriptPubKey.subarray(2, 22)
  return Buffer.concat([
    Buffer.from([0x19, 0x76, 0xa9, 0x14]),
    pubkeyHash,
    Buffer.from([0x88, 0xac]),
  ])
}

/** Serialize an outpoint (txid LE + vout LE). */
const serializeOutpoint = (hash: string, index: number): Buffer => {
  const txid = Buffer.from(hash, 'hex').reverse()
  return Buffer.concat([txid, writeUInt32LE(index)])
}

/** Serialize a Bitcoin output (value + scriptPubKey with varint length). */
const serializeOutput = (amount: bigint, scriptPubKey: Buffer): Buffer =>
  Buffer.concat([writeUInt64LE(amount), writeVarInt(scriptPubKey.length), scriptPubKey])

/**
 * Compute BIP-143 sighashes for all `isOurs` inputs in a SignBitcoin message.
 * Returns one sighash (32 bytes) per input that has `isOurs === true`,
 * in the same order they appear in `signBitcoin.inputs`.
 *
 * Currently supports P2WPKH and P2SH-P2WPKH script types (SIGHASH_ALL only).
 *
 * Follow-up work:
 * - P2TR (Taproot): requires BIP-341 sighash (tagged hashes, Schnorr signatures,
 *   commits to ALL input amounts/scriptPubKeys). See https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
 *   bitcoinjs-lib provides Transaction.hashForWitnessV1() for this.
 * - P2PKH (legacy): requires legacy sighash (not BIP-143).
 *   bitcoinjs-lib provides Transaction.hashForSignature() for this.
 * - P2WSH: requires BIP-143 with the full witnessScript as scriptCode.
 * - SIGHASH_SINGLE, SIGHASH_NONE, ANYONECANPAY: require conditional
 *   hashPrevouts/hashSequence/hashOutputs computation per BIP-143.
 *
 * @see https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki
 */
export const computePreSigningHashes = (
  signBitcoin: SignBitcoin
): Uint8Array[] => {
  const { version, locktime, inputs, outputs } = signBitcoin

  if (inputs.length === 0) {
    throw new Error('SignBitcoin has no inputs')
  }

  const oursCount = inputs.filter(i => i.isOurs).length
  if (oursCount === 0) {
    throw new Error('No signable inputs (all isOurs === false)')
  }

  // hashPrevouts = double_SHA256(all outpoints serialized)
  const prevoutsData = Buffer.concat(
    inputs.map(inp => serializeOutpoint(inp.hash, inp.index))
  )
  const hashPrevouts = hash256(prevoutsData)

  // hashSequence = double_SHA256(all sequences serialized)
  const sequenceData = Buffer.concat(
    inputs.map(inp => writeUInt32LE(inp.sequence ?? 0xffffffff))
  )
  const hashSequence = hash256(sequenceData)

  // hashOutputs = double_SHA256(all outputs serialized)
  const outputsData = Buffer.concat(
    outputs.map(out =>
      serializeOutput(out.amount, Buffer.from(out.scriptPubKey, 'hex'))
    )
  )
  const hashOutputs = hash256(outputsData)

  const sighashes: Uint8Array[] = []

  for (const input of inputs) {
    if (!input.isOurs) continue

    const scriptPubKey = Buffer.from(input.scriptPubKey, 'hex')
    let scriptCode: Buffer

    if (input.scriptType === 'p2wpkh') {
      scriptCode = p2wpkhScriptCode(scriptPubKey)
    } else if (input.scriptType === 'p2sh-p2wpkh') {
      if (!input.redeemScript) {
        throw new Error('P2SH-P2WPKH inputs require redeemScript')
      }
      const redeemScript = Buffer.from(input.redeemScript, 'hex')
      if (
        redeemScript.length !== 22 ||
        redeemScript[0] !== 0x00 ||
        redeemScript[1] !== 0x14
      ) {
        throw new Error('Unsupported redeemScript for p2sh-p2wpkh')
      }
      scriptCode = p2wpkhScriptCode(redeemScript)
    } else {
      throw new Error(
        `Unsupported script type for BIP-143 sighash: ${input.scriptType}`
      )
    }

    const sighashType = input.sighashType ?? 1 // SIGHASH_ALL
    const baseType = sighashType & 0x1f
    const anyoneCanPay = (sighashType & 0x80) !== 0

    if (baseType !== 0x01 || anyoneCanPay) {
      throw new Error(
        `Unsupported sighash type: 0x${sighashType.toString(16)}. ` +
          `Only SIGHASH_ALL (0x01) is currently supported.`
      )
    }

    // BIP-143 preimage:
    // version || hashPrevouts || hashSequence || outpoint || scriptCode || value || sequence || hashOutputs || locktime || sighashType
    const outpoint = serializeOutpoint(input.hash, input.index)
    const preimage = Buffer.concat([
      writeUInt32LE(version),
      hashPrevouts,
      hashSequence,
      outpoint,
      scriptCode,
      writeUInt64LE(input.amount),
      writeUInt32LE(input.sequence ?? 0xffffffff),
      hashOutputs,
      writeUInt32LE(locktime),
      writeUInt32LE(sighashType),
    ])

    sighashes.push(hash256(preimage))
  }

  return sighashes
}

/** @deprecated Use computePreSigningHashes instead */
export const computeBip143Sighashes = computePreSigningHashes
