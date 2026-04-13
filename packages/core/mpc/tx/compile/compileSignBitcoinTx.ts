import { TW } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { KeysignSignature } from '../../keysign/KeysignSignature'
import {
  computePreSigningHashes,
  writeUInt32LE,
  writeUInt64LE,
  writeVarInt,
} from '../../keysign/signingInputs/resolvers/bitcoin/sighash'
import { SignBitcoin } from '../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

/**
 * Build a raw signed Bitcoin transaction from SignBitcoin fields + MPC signatures.
 * Returns an encoded TW.Bitcoin.Proto.SigningOutput so callers can decode it
 * the same way as WalletCore-compiled transactions.
 *
 * Currently only handles single-signer flows where ALL isOurs inputs belong to
 * this vault. Non-ours inputs get empty witnesses, making the tx invalid on-chain
 * if any exist. Multi-party PSBT support (where non-ours inputs have existing
 * signatures from other parties) is a follow-up.
 */
export const compileSignBitcoinTx = (
  signBitcoin: SignBitcoin,
  signatures: Record<string, KeysignSignature>,
  publicKey: PublicKey
): Uint8Array => {
  const hashes = computePreSigningHashes(signBitcoin)
  const pubKeyBytes = Buffer.from(publicKey.data())

  // Build the raw segwit transaction
  const parts: Buffer[] = []

  // Version
  parts.push(writeUInt32LE(signBitcoin.version))

  // Segwit marker + flag
  parts.push(Buffer.from([0x00, 0x01]))

  // Input count
  parts.push(writeVarInt(signBitcoin.inputs.length))

  // Inputs (without witness data)
  for (const input of signBitcoin.inputs) {
    // Outpoint: txid (LE) + vout
    const txid = Buffer.from(input.hash, 'hex').reverse()
    parts.push(txid)
    parts.push(writeUInt32LE(input.index))
    // scriptSig: empty for native P2WPKH, redeemScript push for P2SH-P2WPKH
    if (input.scriptType === 'p2sh-p2wpkh' && input.redeemScript) {
      const redeemScriptBuf = Buffer.from(input.redeemScript, 'hex')
      const scriptSig = Buffer.concat([
        Buffer.from([redeemScriptBuf.length]),
        redeemScriptBuf,
      ])
      parts.push(writeVarInt(scriptSig.length))
      parts.push(scriptSig)
    } else {
      parts.push(Buffer.from([0x00]))
    }
    // Sequence
    parts.push(writeUInt32LE(input.sequence ?? 0xffffffff))
  }

  // Output count
  parts.push(writeVarInt(signBitcoin.outputs.length))

  // Outputs
  for (const output of signBitcoin.outputs) {
    parts.push(writeUInt64LE(output.amount))
    const script = Buffer.from(output.scriptPubKey, 'hex')
    parts.push(writeVarInt(script.length))
    parts.push(script)
  }

  // Witness data for each input
  let hashIndex = 0
  for (const input of signBitcoin.inputs) {
    if (!input.isOurs) {
      // Non-ours inputs: empty witness stack.
      // This makes the tx invalid if non-ours inputs exist.
      // Multi-party PSBT support (preserving existing signatures) is a follow-up.
      parts.push(Buffer.from([0x00]))
      continue
    }

    const hash = hashes[hashIndex++]
    const hashHex = Buffer.from(hash).toString('hex')
    const sig = signatures[hashHex]
    if (!sig) {
      throw new Error(
        `Missing signature for sighash ${hashHex.slice(0, 16)}...`
      )
    }

    const derSig = Buffer.from(sig.der_signature, 'hex')
    const sighashByte = input.sighashType ?? 1
    const sigWithHashType = Buffer.concat([derSig, Buffer.from([sighashByte])])

    // P2WPKH witness: 2 items - [signature+hashtype, pubkey]
    parts.push(Buffer.from([0x02])) // 2 witness items
    parts.push(writeVarInt(sigWithHashType.length))
    parts.push(sigWithHashType)
    parts.push(writeVarInt(pubKeyBytes.length))
    parts.push(pubKeyBytes)
  }

  // Locktime
  parts.push(writeUInt32LE(signBitcoin.locktime))

  const serialized = Buffer.concat(parts)

  // Build signingResultV2 so rebuildPsbtWithPartialSigsFromWC can extract
  // per-input witness items (DER sig + pubkey) to inject into the PSBT.
  hashIndex = 0
  const inputResults = signBitcoin.inputs.map(input => {
    if (!input.isOurs) {
      return { witnessItems: [] as string[] }
    }

    const hash = hashes[hashIndex++]
    const hashHex = Buffer.from(hash).toString('hex')
    const sig = signatures[hashHex]

    const derSig = Buffer.from(sig.der_signature, 'hex')
    const sighashByte = input.sighashType ?? 1
    const sigWithHashType = Buffer.concat([derSig, Buffer.from([sighashByte])])

    return {
      witnessItems: [
        sigWithHashType.toString('base64'),
        pubKeyBytes.toString('base64'),
      ],
    }
  })

  // Wrap in TW.Bitcoin.Proto.SigningOutput with signingResultV2
  // so the extension can extract per-input sigs for PSBT reconstruction.
  const output = TW.Bitcoin.Proto.SigningOutput.create({
    encoded: serialized,
  })
  ;(output as any).signingResultV2 = {
    bitcoin: { inputs: inputResults },
  }

  return TW.Bitcoin.Proto.SigningOutput.encode(output).finish()
}
