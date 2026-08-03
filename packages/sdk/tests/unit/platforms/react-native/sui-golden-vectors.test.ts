/**
 * Sui transaction signing golden-vector byte tests.
 *
 * Gap this fills: `platforms/react-native/chains/sui/tx.ts` deliberately does
 * NOT construct the raw TransactionData BCS bytes (that's built upstream via
 * WalletCore for on-device signing, or by a backend for yield.xyz-style
 * flows) — it only implements the intent-message wrapping (`buildSuiSigningHash`)
 * and the serialized-signature assembly (`buildSuiSerializedSignature`).
 * Neither had a byte-level cross-check against `@mysten/sui`, the chain's own
 * TypeScript SDK.
 *
 * `buildSuiSigningHash` hand-rolls the "intent message" prefix (`[0, 0, 0]`
 * for TransactionData/V0/Sui) instead of using `@mysten/sui`'s BCS-based
 * `messageWithIntent` (which the RN module avoids importing because
 * `@mysten/sui` crashes on Hermes). This test proves the hand-rolled 3-byte
 * prefix produces IDENTICAL bytes to `@mysten/sui/cryptography`'s official
 * intent-wrapping — a genuinely independent implementation, not just a
 * differently-styled copy of the same logic.
 *
 * `buildSuiSerializedSignature` is cross-checked against
 * `@mysten/sui/cryptography`'s `toSerializedSignature`, which is what every
 * other Sui wallet integration uses to assemble the flag||sig||pubkey format.
 */
import { messageWithIntent, toSerializedSignature } from '@mysten/sui/cryptography'
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { fromBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { describe, expect, it } from 'vitest'

import {
  buildSuiSerializedSignature,
  buildSuiSigningHash,
  deriveSuiAddress,
} from '../../../../src/platforms/react-native/chains/sui/tx'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  return bytes
}

// Fixed stand-in for a real BCS-serialized Sui TransactionData blob. The
// intent-wrapping logic under test treats this as opaque bytes, so any fixed
// byte sequence exercises the wrapping correctly.
const FIXED_TX_BYTES = hexToBytes(
  '00020008a0860100000000000200' + '11'.repeat(32) + '02' + '22'.repeat(32) + '0164000000000000000164000000000000'
)
const FIXED_ED25519_PUBKEY = new Uint8Array(32).fill(0x07)
const FIXED_SIGNATURE_R_S = new Uint8Array(64).fill(0x09)

describe('Sui transaction signing golden vectors', () => {
  it('buildSuiSigningHash intent-wraps identically to @mysten/sui messageWithIntent', () => {
    const referenceIntentMessage = messageWithIntent('TransactionData', FIXED_TX_BYTES)

    const result = buildSuiSigningHash(FIXED_TX_BYTES)

    // messageWithIntent returns the *wrapped bytes*; the SDK exposes only the
    // final hash, so verify by hashing the reference wrapping the same way
    // buildSuiSigningHash does internally (blake2b-256) and asserting equal.
    // We assert the intent-wrapped bytes agree by round-tripping the prefix:
    // the first 3 bytes of the reference wrapping must be [0, 0, 0] and the
    // remainder must equal FIXED_TX_BYTES exactly, matching the SDK's
    // hand-rolled construction.
    expect(Array.from(referenceIntentMessage.slice(0, 3))).toEqual([0, 0, 0])
    expect(bytesToHex(referenceIntentMessage.slice(3))).toBe(bytesToHex(FIXED_TX_BYTES))

    // Hash the independently-built intent message and confirm it matches the
    // SDK's own hash output byte-for-byte (both use blake2b-256, dkLen 32).
    const referenceHash = blake2b(referenceIntentMessage, { dkLen: 32 })
    expect(result.hashHex).toBe(bytesToHex(referenceHash))
    expect(result.hashBytes).toEqual(referenceHash)
  })

  it('produces a different hash when the tx bytes change (regression guard)', () => {
    const a = buildSuiSigningHash(FIXED_TX_BYTES)
    const b = buildSuiSigningHash(new Uint8Array([...FIXED_TX_BYTES, 0x99]))
    expect(a.hashHex).not.toBe(b.hashHex)
  })

  it('buildSuiSerializedSignature matches @mysten/sui toSerializedSignature (ED25519)', () => {
    const result = buildSuiSerializedSignature(FIXED_SIGNATURE_R_S, bytesToHex(FIXED_ED25519_PUBKEY))

    const referenceSerialized = toSerializedSignature({
      signatureScheme: 'ED25519',
      signature: FIXED_SIGNATURE_R_S,
      publicKey: new Ed25519PublicKey(FIXED_ED25519_PUBKEY),
    })
    const referenceBytes = fromBase64(referenceSerialized)

    expect(result.length).toBe(97)
    expect(bytesToHex(result)).toBe(bytesToHex(referenceBytes))
    // flag byte 0x00 = ED25519 per SIGNATURE_SCHEME_TO_FLAG
    expect(result[0]).toBe(0x00)
  })

  it('deriveSuiAddress matches @mysten/sui Ed25519PublicKey.toSuiAddress()', () => {
    const address = deriveSuiAddress(bytesToHex(FIXED_ED25519_PUBKEY))
    const referenceAddress = new Ed25519PublicKey(FIXED_ED25519_PUBKEY).toSuiAddress()
    expect(address).toBe(referenceAddress)
  })
})
