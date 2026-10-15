import { Buffer } from 'buffer'
import { Chain } from '@vultisig/core-chain/Chain'
import { script as bitcoinScript, Transaction } from 'bitcoinjs-lib'
import { TW } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { KeysignSignature } from '../../keysign/KeysignSignature'
import { computePreSigningHashes } from '../../keysign/signingInputs/resolvers/bitcoin/sighash'
import { SignBitcoin } from '../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

/**
 * Build a raw signed Bitcoin-family transaction from SignBitcoin fields + MPC signatures.
 * Uses bitcoinjs-lib's Transaction class for serialization (proper varint encoding,
 * witness handling, segwit markers).
 *
 * Returns an encoded TW.Bitcoin.Proto.SigningOutput so callers can decode it
 * the same way as WalletCore-compiled transactions.
 *
 * Segwit inputs (P2WPKH, P2SH-P2WPKH) get a witness; legacy P2PKH inputs —
 * SwapKit's DOGE / BCH / DASH PSBTs, hashed per `chain` — get a scriptSig and
 * serialize without any segwit marker, keeping the PSBT's version and locktime.
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
  publicKey: PublicKey,
  chain: Chain = Chain.Bitcoin
): Uint8Array => {
  const hashes = computePreSigningHashes(signBitcoin, chain)
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
      const scriptSig = Buffer.concat([Buffer.from([redeemScriptBuf.length]), redeemScriptBuf])
      tx.setInputScript(tx.ins.length - 1, scriptSig)
    }
  }

  // Add outputs
  for (const output of signBitcoin.outputs) {
    tx.addOutput(Buffer.from(output.scriptPubKey, 'hex'), output.amount)
  }

  // Set the unlocking data for each input
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
      throw new Error(`Missing signature for sighash ${hashHex.slice(0, 16)}...`)
    }

    const derSig = Buffer.from(sig.der_signature, 'hex')
    const sighashByte = (input.sighashType ?? 1) & 0xff
    const sigWithHashType = Buffer.concat([derSig, Buffer.from([sighashByte])])

    if (input.scriptType === 'p2pkh') {
      // Legacy P2PKH scriptSig: <signature+hashtype> <pubkey>; no witness.
      tx.setInputScript(i, bitcoinScript.compile([sigWithHashType, pubKeyBytes]))
    } else {
      // P2WPKH witness: [signature+hashtype, pubkey]
      tx.setWitness(i, [sigWithHashType, pubKeyBytes])
    }
  }

  const serialized = tx.toBuffer()

  // Build signingResultV2 so rebuildPsbtWithPartialSigsFromWC can extract
  // per-input witness items (DER sig + pubkey) to inject into the PSBT.
  // See: vultisig-windows/clients/extension/src/utils/functions.ts
  // Legacy P2PKH inputs carry their signature in the scriptSig and have none.
  hashIndex = 0
  const inputResults = signBitcoin.inputs.map(input => {
    if (!input.isOurs) {
      return { witnessItems: [] as Uint8Array[] }
    }

    const hash = hashes[hashIndex++]
    const hashHex = Buffer.from(hash).toString('hex')
    const sig = signatures[hashHex]

    if (input.scriptType === 'p2pkh') {
      return { witnessItems: [] as Uint8Array[] }
    }

    const derSig = Buffer.from(sig.der_signature, 'hex')
    const sighashByte = input.sighashType ?? 1
    const sigWithHashType = Buffer.concat([derSig, Buffer.from([sighashByte])])

    return {
      witnessItems: [new Uint8Array(sigWithHashType), new Uint8Array(pubKeyBytes)],
    }
  })

  // Wrap in TW.Bitcoin.Proto.SigningOutput with signingResultV2
  // so the extension can extract per-input sigs for PSBT reconstruction.
  // signingResultV2 is a proper field on SigningOutput (see TW.BitcoinV2.Proto.ISigningOutput)
  // and, like WalletCore's own V2 output, it also carries the signed tx and
  // txid: the UTXO broadcast and hash resolvers read those before the legacy fields.
  const output = TW.Bitcoin.Proto.SigningOutput.create({
    encoded: serialized,
    transactionId: tx.getId(),
    signingResultV2: {
      encoded: serialized,
      // Internal byte order, as WalletCore emits it; getUtxoTxHash reverses it for display.
      txid: tx.getHash(),
      bitcoin: { inputs: inputResults },
    },
  })

  return TW.Bitcoin.Proto.SigningOutput.encode(output).finish()
}
