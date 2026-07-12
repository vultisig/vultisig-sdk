/**
 * dApp-supplied raw Solana transaction handling (sdk#1204).
 *
 * For `signData.signSolana` transactions we sign the message bytes directly
 * instead of routing through `SolanaSigningInput.rawMessage` +
 * `TransactionCompiler`. The round-trip through WalletCore's proto re-encoder
 * is sensitive to WalletCore version differences between platforms — even a
 * one-byte drift in the re-encoded message (v0 + address-lookup-table
 * transactions are the known-risky shape) produces a different pre-image,
 * which breaks Secure Vault co-signing: the other party computes a different
 * hash, the setup-message equality check throws, and no TSS messages are ever
 * emitted. For Solana, ed25519 signs the wire-format message verbatim, so
 * extracting it directly is canonical and cross-platform safe.
 *
 * Byte-for-byte port of vultisig-ios#4419 (`Solana.swift`
 * `extractSolanaMessageBytes` / `signRawTransaction`); Android sibling is
 * vultisig-android#5223. Wire format of a serialized Solana transaction:
 *
 *   [shortvec(numSignatures)][numSignatures x 64-byte signature][message]
 */

export type ParsedSolanaRawTx = {
  /** Byte offset of the first (fee payer, signer index 0) signature slot. */
  firstSignatureOffset: number
  /** Declared signature-slot count from the shortvec envelope. */
  numSignatures: number
  /** The Solana wire-format message bytes — the exact ed25519 pre-image. */
  message: Uint8Array
}

/**
 * Strip the `[shortvec(numSigs)][numSigs x 64-byte sig]` envelope and return
 * the underlying Solana message bytes plus the offset of the first signature
 * slot (for later splice-in).
 */
export function extractSolanaMessageBytes(txData: Uint8Array): ParsedSolanaRawTx {
  let offset = 0
  let numSigs = 0
  let shift = 0
  // Solana compact-u16 (shortvec) decode: 7 bits per byte, high bit = continuation.
  while (offset < txData.length) {
    const byte = txData[offset]
    numSigs |= (byte & 0x7f) << shift
    offset += 1
    if ((byte & 0x80) === 0) break
    shift += 7
    if (shift > 14) {
      throw new Error('Invalid shortvec for signature count')
    }
  }
  if (numSigs < 1) {
    throw new Error('Transaction declares no signatures')
  }
  const firstSignatureOffset = offset
  const messageOffset = offset + numSigs * 64
  if (messageOffset >= txData.length) {
    throw new Error(`Transaction too short for declared signature count (${numSigs})`)
  }
  return {
    firstSignatureOffset,
    numSignatures: numSigs,
    message: txData.slice(messageOffset),
  }
}

/**
 * Splice the 64-byte signature into the original transaction at signer
 * index 0 (the dApp builds the tx with the user as fee payer == first
 * signer; any other signature slots stay as the dApp-provided placeholders).
 * Returns a new array — the input is not mutated.
 */
export function spliceSolanaSignature(txData: Uint8Array, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) {
    throw new Error(`Solana signature must be 64 bytes, got ${signature.length}`)
  }
  const { firstSignatureOffset } = extractSolanaMessageBytes(txData)
  if (firstSignatureOffset + 64 > txData.length) {
    throw new Error('Transaction too short to place signature')
  }
  const signedTx = new Uint8Array(txData)
  signedTx.set(signature, firstSignatureOffset)
  return signedTx
}
