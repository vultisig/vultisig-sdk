import { sha256 } from '@noble/hashes/sha2.js'
import bs58 from 'bs58'
import { Buffer } from 'buffer'

const ED25519_KEY_TYPE = 0x00
const ED25519_SIGNATURE_BYTES = 64
const ACCOUNT_ID_LENGTH_BYTES = 4

/**
 * Borsh layout (nearcore `core/primitives/src/transaction.rs`): the bare
 * `TransactionV0` body, then a key-type byte and the signature. WalletCore emits
 * Ed25519 only, so the envelope is 65 bytes and the body is the signed prefix.
 */
const splitNearSignedTransaction = (signedTransaction: Uint8Array): Uint8Array => {
  const bodyLength = signedTransaction.length - ED25519_SIGNATURE_BYTES - 1

  if (bodyLength <= 0) {
    throw new Error('NEAR signed transaction is too short to carry a body and an Ed25519 signature')
  }

  if (signedTransaction[bodyLength] !== ED25519_KEY_TYPE) {
    throw new Error('NEAR signed transaction does not carry an Ed25519 signature')
  }

  return signedTransaction.subarray(0, bodyLength)
}

/**
 * The chain's transaction id: `sha256(borsh(TransactionV0))`, base58.
 *
 * nearcore sets `SignedTransaction.hash` to `Transaction::get_hash_and_size()`
 * (`transaction.rs:416-437`), and V0 serializes with no variant tag, so the id is
 * the digest that was signed — *not* the hash of the signed bytes.
 */
export const getNearTransactionHash = (signedTransaction: Uint8Array): string =>
  bs58.encode(sha256(splitNearSignedTransaction(signedTransaction)))

/** Signer account, read from the body's leading Borsh `AccountId` (u32-LE length + UTF-8). */
export const getNearSignerId = (signedTransaction: Uint8Array): string => {
  const body = splitNearSignedTransaction(signedTransaction)

  if (body.length < ACCOUNT_ID_LENGTH_BYTES) {
    throw new Error('NEAR signed transaction is too short to carry a signer account id')
  }

  const length = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, true)

  if (length === 0 || ACCOUNT_ID_LENGTH_BYTES + length > body.length) {
    throw new Error('NEAR signed transaction carries a malformed signer account id')
  }

  return Buffer.from(body.subarray(ACCOUNT_ID_LENGTH_BYTES, ACCOUNT_ID_LENGTH_BYTES + length)).toString('utf8')
}
