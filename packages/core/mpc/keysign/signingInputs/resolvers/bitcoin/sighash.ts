import { createHash } from 'crypto'

import { SignBitcoin } from '../../../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

/** Double-SHA256 as used in Bitcoin consensus. */
const hash256 = (data: Buffer): Buffer =>
  createHash('sha256')
    .update(createHash('sha256').update(data).digest())
    .digest()

/** Serialize a uint32 as 4 bytes little-endian. */
const writeUInt32LE = (value: number): Buffer => {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(value)
  return buf
}

/** Serialize a int64 as 8 bytes little-endian. */
const writeInt64LE = (value: bigint): Buffer => {
  const buf = Buffer.alloc(8)
  buf.writeBigInt64LE(value)
  return buf
}

/**
 * Derive BIP-143 scriptCode from a P2WPKH scriptPubKey.
 * 0x0014<20-byte-hash> -> OP_DUP OP_HASH160 <20> <hash> OP_EQUALVERIFY OP_CHECKSIG
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
const serializeOutput = (amount: bigint, scriptPubKey: Buffer): Buffer => {
  const scriptLen = Buffer.from([scriptPubKey.length])
  return Buffer.concat([writeInt64LE(amount), scriptLen, scriptPubKey])
}

/**
 * Compute BIP-143 sighashes for all `is_ours` inputs in a SignBitcoin message.
 * Returns one sighash (32 bytes) per input that has `isOurs === true`,
 * in the same order they appear in `signBitcoin.inputs`.
 *
 * Supports P2WPKH and P2SH-P2WPKH script types.
 * P2PKH (legacy) and P2TR (Taproot BIP-341) will be added in follow-up work.
 */
export const computeBip143Sighashes = (
  signBitcoin: SignBitcoin
): Uint8Array[] => {
  const { version, locktime, inputs, outputs } = signBitcoin

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
      throw new Error(`Unsupported sighash type for BIP-143: ${sighashType}`)
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
      writeInt64LE(input.amount),
      writeUInt32LE(input.sequence ?? 0xffffffff),
      hashOutputs,
      writeUInt32LE(locktime),
      writeUInt32LE(sighashType),
    ])

    sighashes.push(hash256(preimage))
  }

  return sighashes
}
