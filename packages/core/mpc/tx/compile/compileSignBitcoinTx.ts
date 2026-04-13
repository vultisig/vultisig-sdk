import { Transaction } from 'bitcoinjs-lib'
import { TW } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { KeysignSignature } from '../../keysign/KeysignSignature'
import { computePreSigningHashes } from '../../keysign/signingInputs/resolvers/bitcoin/sighash'
import { SignBitcoin } from '../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

/**
 * Build a raw signed Bitcoin transaction from SignBitcoin fields + MPC signatures.
 * Uses bitcoinjs-lib's Transaction class for serialization (proper varint encoding,
 * witness handling, segwit markers).
 *
 * Returns an encoded TW.Bitcoin.Proto.SigningOutput so callers can decode it
 * the same way as WalletCore-compiled transactions.
 *
 * Currently only handles single-signer flows where ALL isOurs inputs belong to
 * this vault. Non-ours inputs get empty witnesses, making the tx invalid on-chain
 * if any exist. Multi-party PSBT support (where non-ours inputs have existing
 * signatures from other parties) is a follow-up.
 *
 * @see https://www.npmjs.org/package/bitcoinjs-lib
 */
export const compileSignBitcoinTx = (
  signBitcoin: SignBitcoin,
  signatures: Record<string, KeysignSignature>,
  publicKey: PublicKey
): Uint8Array => {
  const hashes = computePreSigningHashes(signBitcoin)
  const pubKeyBytes = Buffer.from(publicKey.data())

  // Build the transaction using bitcoinjs-lib's Transaction class
  // which handles varint encoding, segwit markers, and witness serialization.
  const tx = new Transaction()
  tx.version = signBitcoin.version
  tx.locktime = signBitcoin.locktime

  // Add inputs
  for (const input of signBitcoin.inputs) {
    const txid = Buffer.from(input.hash, 'hex').reverse() // display -> internal byte order
    tx.addInput(txid, input.index, input.sequence ?? 0xffffffff)

    // P2SH-P2WPKH: set scriptSig to redeemScript push
    if (input.scriptType === 'p2sh-p2wpkh' && input.redeemScript) {
      const redeemScriptBuf = Buffer.from(input.redeemScript, 'hex')
      tx.ins[tx.ins.length - 1].script = Buffer.concat([
        Buffer.from([redeemScriptBuf.length]),
        redeemScriptBuf,
      ])
    }
  }

  // Add outputs
  for (const output of signBitcoin.outputs) {
    tx.addOutput(Buffer.from(output.scriptPubKey, 'hex'), output.amount)
  }

  // Set witness data for each input
  let hashIndex = 0
  for (let i = 0; i < signBitcoin.inputs.length; i++) {
    const input = signBitcoin.inputs[i]

    if (!input.isOurs) {
      // Non-ours inputs: empty witness stack.
      // This makes the tx invalid if non-ours inputs exist.
      // Multi-party PSBT support (preserving existing signatures) is a follow-up.
      tx.setWitness(i, [])
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

    // P2WPKH witness: [signature+hashtype, pubkey]
    tx.setWitness(i, [sigWithHashType, pubKeyBytes])
  }

  const serialized = tx.toBuffer()

  // Build signingResultV2 so rebuildPsbtWithPartialSigsFromWC can extract
  // per-input witness items (DER sig + pubkey) to inject into the PSBT.
  // See: vultisig-windows/clients/extension/src/utils/functions.ts
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
