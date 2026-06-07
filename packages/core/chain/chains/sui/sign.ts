import { blake2b } from '@noble/hashes/blake2'

/**
 * Sui intent prefixes — `[scope, version, app_id]`. Version is always `0` (V0)
 * and `app_id` is always `0` (Sui). See `@mysten/sui/cryptography/intent`.
 *
 * The public exports are separate `Uint8Array` instances cloned from the
 * private source buffers, so a consumer mutating an imported intent can't
 * corrupt the bytes the digest helpers below feed into every blake2b call.
 */
const suiTransactionDataIntentBytes = new Uint8Array([0, 0, 0])
const suiPersonalMessageIntentBytes = new Uint8Array([3, 0, 0])

export const suiTransactionDataIntent = new Uint8Array(suiTransactionDataIntentBytes)
export const suiPersonalMessageIntent = new Uint8Array(suiPersonalMessageIntentBytes)

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

const encodeUleb128 = (n: number): Uint8Array => {
  const out: number[] = []
  let v = n
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v >>>= 7
  }
  out.push(v & 0x7f)
  return new Uint8Array(out)
}

/**
 * Produce the Sui intent-prefixed blake2b-256 digest of a built PTB. This is
 * the 32-byte hash that the wallet's Ed25519 signer signs.
 */
export const getSuiTransactionDataDigest = (txBytes: Uint8Array): Uint8Array =>
  blake2b(concatBytes(suiTransactionDataIntentBytes, txBytes), { dkLen: 32 })

/**
 * Produce the Sui intent-prefixed blake2b-256 digest of a personal message.
 * The message is BCS-wrapped as `vector<u8>` (uleb128 length || bytes) before
 * hashing.
 */
export const getSuiPersonalMessageDigest = (messageBytes: Uint8Array): Uint8Array =>
  blake2b(concatBytes(suiPersonalMessageIntentBytes, encodeUleb128(messageBytes.length), messageBytes), { dkLen: 32 })

const ed25519SchemeFlag = 0x00
const ed25519SignatureLength = 64
const ed25519PublicKeyLength = 32

type BuildSuiSerializedSignatureInput = {
  signature: Uint8Array
  publicKey: Uint8Array
}

/**
 * Assemble a Sui Wallet Standard wire signature for an Ed25519 vault:
 * `flag(1) || signature(64) || publicKey(32)`. The result is 97 bytes; callers
 * typically base64-encode it before returning to the dApp.
 */
export const buildSuiSerializedSignature = ({ signature, publicKey }: BuildSuiSerializedSignatureInput): Uint8Array => {
  if (signature.length !== ed25519SignatureLength) {
    throw new Error(`Sui Ed25519 signature must be ${ed25519SignatureLength} bytes, got ${signature.length}`)
  }
  if (publicKey.length !== ed25519PublicKeyLength) {
    throw new Error(`Sui Ed25519 public key must be ${ed25519PublicKeyLength} bytes, got ${publicKey.length}`)
  }
  const out = new Uint8Array(1 + ed25519SignatureLength + ed25519PublicKeyLength)
  out[0] = ed25519SchemeFlag
  out.set(signature, 1)
  out.set(publicKey, 1 + ed25519SignatureLength)
  return out
}
