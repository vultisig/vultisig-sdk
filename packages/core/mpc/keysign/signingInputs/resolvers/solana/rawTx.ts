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
 *
 * and of the message itself (legacy, or v0 behind a `0x80 | version` byte):
 *
 *   [header: 3 bytes][shortvec(numKeys)][numKeys x 32-byte key][blockhash]...
 *
 * Signature slot `i` belongs to static account key `i`, and the first
 * `header.numRequiredSignatures` keys are the signers.
 */

const signatureLength = 64
const publicKeyLength = 32
const messageHeaderLength = 3
const versionPrefixMask = 0x80

export type ParsedSolanaRawTx = {
  /** Byte offset of the first (fee payer, signer index 0) signature slot. */
  firstSignatureOffset: number
  /** Declared signature-slot count from the shortvec envelope. */
  numSignatures: number
  /** The Solana wire-format message bytes — the exact ed25519 pre-image. */
  message: Uint8Array
}

type ShortVec = {
  value: number
  /** Offset of the first byte after the encoded length. */
  end: number
}

// Solana compact-u16 (shortvec) decode: 7 bits per byte, high bit = continuation.
const decodeShortVec = (bytes: Uint8Array, offset: number, label: string): ShortVec => {
  let value = 0
  let shift = 0
  let cursor = offset
  while (cursor < bytes.length) {
    const byte = bytes[cursor]
    value |= (byte & 0x7f) << shift
    cursor += 1
    if ((byte & 0x80) === 0) {
      return { value, end: cursor }
    }
    shift += 7
    if (shift > 14) {
      throw new Error(`Invalid shortvec for ${label}`)
    }
  }
  throw new Error(`Transaction too short to read ${label}`)
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

/**
 * Strip the `[shortvec(numSigs)][numSigs x 64-byte sig]` envelope and return
 * the underlying Solana message bytes plus the offset of the first signature
 * slot (for later splice-in).
 */
export function extractSolanaMessageBytes(txData: Uint8Array): ParsedSolanaRawTx {
  const { value: numSigs, end: firstSignatureOffset } = decodeShortVec(txData, 0, 'signature count')
  if (numSigs < 1) {
    throw new Error('Transaction declares no signatures')
  }
  const messageOffset = firstSignatureOffset + numSigs * signatureLength
  if (messageOffset >= txData.length) {
    throw new Error(`Transaction too short for declared signature count (${numSigs})`)
  }
  return {
    firstSignatureOffset,
    numSignatures: numSigs,
    message: txData.slice(messageOffset),
  }
}

type GetSolanaSignerIndexInput = {
  /** The wire-format message (legacy or v0), as returned by `extractSolanaMessageBytes`. */
  message: Uint8Array
  /** The 32-byte ed25519 public key whose slot is being resolved. */
  publicKey: Uint8Array
}

/**
 * Resolves the signature slot a public key owns: its position among the
 * message's static account keys, which must fall within the header's
 * `numRequiredSignatures`. Throws when the key is not a required signer, so a
 * caller can never write a signature into somebody else's slot.
 */
export function getSolanaSignerIndex({ message, publicKey }: GetSolanaSignerIndexInput): number {
  if (publicKey.length !== publicKeyLength) {
    throw new Error(`Solana public key must be ${publicKeyLength} bytes, got ${publicKey.length}`)
  }
  if (message.length === 0) {
    throw new Error('Solana message is empty')
  }

  let headerOffset = 0
  if ((message[0] & versionPrefixMask) !== 0) {
    const version = message[0] & 0x7f
    if (version !== 0) {
      throw new Error(`Unsupported Solana message version ${version}`)
    }
    headerOffset = 1
  }
  if (message.length < headerOffset + messageHeaderLength) {
    throw new Error('Solana message too short for header')
  }

  const numRequiredSignatures = message[headerOffset]
  const { value: numKeys, end: keysOffset } = decodeShortVec(
    message,
    headerOffset + messageHeaderLength,
    'account key count'
  )
  if (numKeys < numRequiredSignatures) {
    throw new Error(`Solana message requires ${numRequiredSignatures} signatures but lists ${numKeys} account keys`)
  }
  if (keysOffset + numKeys * publicKeyLength > message.length) {
    throw new Error(`Solana message too short for declared account key count (${numKeys})`)
  }

  for (let index = 0; index < numRequiredSignatures; index++) {
    const start = keysOffset + index * publicKeyLength
    if (bytesEqual(message.subarray(start, start + publicKeyLength), publicKey)) {
      return index
    }
  }

  throw new Error('Public key is not a required signer of the Solana transaction')
}

type SpliceSolanaSignatureInput = {
  txData: Uint8Array
  signature: Uint8Array
  /** The 32-byte ed25519 public key the signature was produced with. */
  publicKey: Uint8Array
}

/**
 * Splice the 64-byte signature into the original transaction at the slot the
 * public key owns. The vault is usually the fee payer (slot 0), but a
 * sponsored or multi-signer transaction can put it at any signer index, and
 * the runtime verifies slot `i` against account `i`, so the slot is resolved
 * from the message rather than assumed. Every other slot stays exactly as the
 * dApp provided it, including co-signers' existing signatures. Returns a new
 * array — the input is not mutated.
 */
export function spliceSolanaSignature({ txData, signature, publicKey }: SpliceSolanaSignatureInput): Uint8Array {
  if (signature.length !== signatureLength) {
    throw new Error(`Solana signature must be ${signatureLength} bytes, got ${signature.length}`)
  }
  const { firstSignatureOffset, numSignatures, message } = extractSolanaMessageBytes(txData)
  const signerIndex = getSolanaSignerIndex({ message, publicKey })
  if (signerIndex >= numSignatures) {
    throw new Error(`Transaction declares ${numSignatures} signature slot(s) but the signer is at index ${signerIndex}`)
  }
  const signedTx = new Uint8Array(txData)
  signedTx.set(signature, firstSignatureOffset + signerIndex * signatureLength)
  return signedTx
}
