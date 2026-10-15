import { Buffer } from 'buffer'
import { Chain } from '@vultisig/core-chain/Chain'
import { sha256 } from '@noble/hashes/sha2.js'

import { BitcoinInput, SignBitcoin } from '../../../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

// -- Shared serialization utilities --
// See https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki

/** Double-SHA256 as used in Bitcoin consensus. */
const hash256 = (data: Uint8Array): Buffer => Buffer.from(sha256(sha256(data)))

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
  if (n < 0 || n > 0xffffffff) {
    throw new Error(`writeVarInt: value out of range: ${n}`)
  }
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

/** A script with its CompactSize length prefix, as scriptCode and scriptSig fields are serialized. */
const writeVarSlice = (script: Buffer): Buffer => Buffer.concat([writeVarInt(script.length), script])

/**
 * Derive BIP-143 scriptCode from a P2WPKH scriptPubKey.
 * 0x0014<20-byte-hash> -> OP_DUP OP_HASH160 <20> <hash> OP_EQUALVERIFY OP_CHECKSIG
 * The 0x19 length prefix is part of the scriptCode per BIP-143.
 */
const p2wpkhScriptCode = (scriptPubKey: Buffer): Buffer => {
  const pubkeyHash = scriptPubKey.subarray(2, 22)
  return Buffer.concat([Buffer.from([0x19, 0x76, 0xa9, 0x14]), pubkeyHash, Buffer.from([0x88, 0xac])])
}

/** Serialize an outpoint (txid LE + vout LE). */
const serializeOutpoint = (hash: string, index: number): Buffer => {
  const txid = Buffer.from(hash, 'hex').reverse()
  return Buffer.concat([txid, writeUInt32LE(index)])
}

/** Serialize a Bitcoin output (value + scriptPubKey with varint length). */
const serializeOutput = (amount: bigint, scriptPubKey: Buffer): Buffer =>
  Buffer.concat([writeUInt64LE(amount), writeVarInt(scriptPubKey.length), scriptPubKey])

const sighashAll = 0x01
const sighashForkId = 0x40

type LegacyP2pkhDigest = 'legacy' | 'forkId'

/**
 * How a P2PKH input is digested on the chains whose SwapKit PSBTs spend legacy
 * P2PKH outputs. DOGE and DASH use the original pre-BIP143 whole-transaction
 * sighash; BCH uses a BIP143-style digest under SIGHASH_FORKID with the P2PKH
 * script as scriptCode. Bitcoin P2PKH stays unsupported: the vault's own
 * Bitcoin address is native segwit.
 */
const legacyP2pkhDigest: Partial<Record<Chain, LegacyP2pkhDigest>> = {
  [Chain.Dogecoin]: 'legacy',
  [Chain.Dash]: 'legacy',
  [Chain.BitcoinCash]: 'forkId',
}

type LegacySighashInput = {
  signBitcoin: SignBitcoin
  signingIndex: number
  scriptPubKey: Buffer
  sighashType: number
}

/**
 * Pre-BIP143 SIGHASH_ALL: the whole transaction with the signed input's
 * scriptSig replaced by its scriptPubKey and every other scriptSig emptied,
 * followed by the 4-byte sighash type.
 */
const legacySighash = ({ signBitcoin, signingIndex, scriptPubKey, sighashType }: LegacySighashInput): Buffer => {
  const { version, locktime, inputs, outputs } = signBitcoin

  return hash256(
    Buffer.concat([
      writeUInt32LE(version),
      writeVarInt(inputs.length),
      ...inputs.flatMap((input, index) => [
        serializeOutpoint(input.hash, input.index),
        index === signingIndex ? writeVarSlice(scriptPubKey) : writeVarInt(0),
        writeUInt32LE(input.sequence ?? 0xffffffff),
      ]),
      writeVarInt(outputs.length),
      ...outputs.map(out => serializeOutput(out.amount, Buffer.from(out.scriptPubKey, 'hex'))),
      writeUInt32LE(locktime),
      writeUInt32LE(sighashType),
    ])
  )
}

const assertSighashType = (input: BitcoinInput, expected: number, label: string): number => {
  const sighashType = input.sighashType ?? sighashAll
  if (sighashType !== expected) {
    throw new Error(
      `Unsupported sighash type: 0x${sighashType.toString(16)} for a ${label} input; ` +
        `only 0x${expected.toString(16)} is supported.`
    )
  }
  return sighashType
}

/**
 * Compute the sighash of every `isOurs` input in a SignBitcoin message, one
 * 32-byte digest per input in the order they appear in `signBitcoin.inputs`.
 *
 * Bitcoin (the default `chain`) supports P2WPKH and P2SH-P2WPKH inputs under
 * BIP-143 SIGHASH_ALL. On DOGE, DASH and BCH — where SwapKit's PSBTs spend
 * legacy P2PKH outputs — P2PKH inputs are digested with each chain's own
 * algorithm (see `legacyP2pkhDigest`), preserving the transaction version and
 * locktime the PSBT declares.
 *
 * Follow-up work:
 * - P2TR (Taproot): requires BIP-341 sighash (tagged hashes, Schnorr signatures,
 *   commits to ALL input amounts/scriptPubKeys). See https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
 *   bitcoinjs-lib provides Transaction.hashForWitnessV1() for this.
 * - P2WSH: requires BIP-143 with the full witnessScript as scriptCode.
 * - SIGHASH_SINGLE, SIGHASH_NONE, ANYONECANPAY: require conditional
 *   hashPrevouts/hashSequence/hashOutputs computation per BIP-143.
 *
 * @see https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki
 */
export const computePreSigningHashes = (signBitcoin: SignBitcoin, chain: Chain = Chain.Bitcoin): Uint8Array[] => {
  const { version, locktime, inputs, outputs } = signBitcoin

  if (inputs.length === 0) {
    throw new Error('SignBitcoin has no inputs')
  }

  const oursCount = inputs.filter(i => i.isOurs).length
  if (oursCount === 0) {
    throw new Error('No signable inputs (all isOurs === false)')
  }

  // hashPrevouts = double_SHA256(all outpoints serialized)
  const prevoutsData = Buffer.concat(inputs.map(inp => serializeOutpoint(inp.hash, inp.index)))
  const hashPrevouts = hash256(prevoutsData)

  // hashSequence = double_SHA256(all sequences serialized)
  const sequenceData = Buffer.concat(inputs.map(inp => writeUInt32LE(inp.sequence ?? 0xffffffff)))
  const hashSequence = hash256(sequenceData)

  // hashOutputs = double_SHA256(all outputs serialized)
  const outputsData = Buffer.concat(
    outputs.map(out => serializeOutput(out.amount, Buffer.from(out.scriptPubKey, 'hex')))
  )
  const hashOutputs = hash256(outputsData)

  const sighashes: Uint8Array[] = []

  for (const [signingIndex, input] of inputs.entries()) {
    if (!input.isOurs) continue

    if (input.amount < 0n) {
      throw new Error(`Input amount must be non-negative, got ${input.amount}`)
    }

    const scriptPubKey = Buffer.from(input.scriptPubKey, 'hex')
    let scriptCode: Buffer
    let sighashType: number

    if (input.scriptType === 'p2pkh') {
      const digest = legacyP2pkhDigest[chain]
      if (!digest) {
        throw new Error(`Unsupported script type for BIP-143 sighash: ${input.scriptType}`)
      }
      if (digest === 'legacy') {
        sighashType = assertSighashType(input, sighashAll, `${chain} P2PKH`)
        sighashes.push(legacySighash({ signBitcoin, signingIndex, scriptPubKey, sighashType }))
        continue
      }
      sighashType = assertSighashType(input, sighashAll | sighashForkId, `${chain} P2PKH`)
      scriptCode = writeVarSlice(scriptPubKey)
    } else {
      if (input.scriptType === 'p2wpkh') {
        scriptCode = p2wpkhScriptCode(scriptPubKey)
      } else if (input.scriptType === 'p2sh-p2wpkh') {
        if (!input.redeemScript) {
          throw new Error('P2SH-P2WPKH inputs require redeemScript')
        }
        const redeemScript = Buffer.from(input.redeemScript, 'hex')
        if (redeemScript.length !== 22 || redeemScript[0] !== 0x00 || redeemScript[1] !== 0x14) {
          throw new Error('Unsupported redeemScript for p2sh-p2wpkh')
        }
        scriptCode = p2wpkhScriptCode(redeemScript)
      } else {
        throw new Error(`Unsupported script type for BIP-143 sighash: ${input.scriptType}`)
      }

      sighashType = input.sighashType ?? sighashAll
      const baseType = sighashType & 0x1f
      const anyoneCanPay = (sighashType & 0x80) !== 0

      if (baseType !== sighashAll || anyoneCanPay) {
        throw new Error(
          `Unsupported sighash type: 0x${sighashType.toString(16)}. ` +
            `Only SIGHASH_ALL (0x01) is currently supported.`
        )
      }
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
