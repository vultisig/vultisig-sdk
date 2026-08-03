/**
 * Synthetic (non-vault) signing round-trip regression test.
 *
 * Context — SDK-TEST-02/03 (vultisig/vultisig-sdk#1069):
 * The only test that exercises a full sign -> format -> verify round trip
 * today is tests/e2e/fast-signing.test.ts, which is
 * describe.skipIf(!HAS_TEST_VAULT_FIXTURE) and therefore skipped everywhere
 * except a daily cron that requires a provisioned vault secret. That leaves
 * ZERO always-on coverage proving the SDK's signature adapter
 * (formatSignature) actually round-trips a cryptographically valid
 * signature: every existing unit test feeds it hand-typed r/s/der strings
 * that were never produced or checked by real curve math (see
 * tests/unit/adapters/formatSignature.test.ts).
 *
 * This test closes that gap without any vault or network dependency: it
 * signs a message with an ephemeral secp256k1/ed25519 keypair (standing in
 * for what a real 2-of-2 TSS ceremony ultimately produces - an ordinary,
 * verifiable signature over a message hash), runs the result through the
 * SAME formatSignature() adapter the SDK uses for real keysign output, then
 * independently verifies the *formatted* signature against the public key
 * with the underlying curve library. If curve math, hex encoding, or the
 * DER / raw-r||s adapter logic regresses, this test fails on every PR -
 * regardless of whether a real vault fixture is configured.
 */
import { ed25519 } from '@noble/curves/ed25519.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha256.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import type { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import type { KeysignSignature } from '@vultisig/core-mpc/keysign/KeysignSignature'
import { describe, expect, it } from 'vitest'

import { formatSignature } from '../../../src/adapters/formatSignature'

describe('signing round trip (synthetic, non-vault-gated) — SDK-TEST-02/03', () => {
  it('ECDSA: ephemeral secp256k1 keypair signs, SDK adapter formats, signature verifies', () => {
    const privateKey = secp256k1.utils.randomPrivateKey()
    const publicKey = secp256k1.getPublicKey(privateKey)

    const message = new TextEncoder().encode(`vultisig-sdk-synthetic-ecdsa:${Date.now()}`)
    const msgHash = sha256(message)
    const msgHashHex = `0x${bytesToHex(msgHash)}`

    const sig = secp256k1.sign(msgHash, privateKey)

    const signatureResults: Record<string, KeysignSignature> = {
      [msgHashHex]: {
        msg: msgHashHex,
        r: `0x${sig.r.toString(16)}`,
        s: `0x${sig.s.toString(16)}`,
        der_signature: `0x${sig.toDERHex()}`,
        recovery_id: String(sig.recovery),
      },
    }

    const formatted = formatSignature(signatureResults, [msgHashHex], 'ecdsa' satisfies SignatureAlgorithm)

    expect(formatted.format).toBe('ECDSA')
    expect(formatted.recovery).toBe(sig.recovery)
    expect(formatted.signature).toMatch(/^0x[0-9a-f]+$/i)

    // Real cryptographic verification of the adapter's own output — not a shape check.
    const derBytes = hexToBytes(formatted.signature.replace(/^0x/, ''))
    expect(secp256k1.verify(derBytes, msgHash, publicKey)).toBe(true)

    // Pin the DER *format* explicitly. formatSignature() is responsible for
    // SELECTING DER (not raw r||s) for ECDSA, but secp256k1.verify() accepts
    // BOTH DER and 64-byte compact r||s — so verify() alone would stay green if
    // the adapter regressed from DER passthrough to r||s. Parsing strictly as
    // DER (throws on a compact signature) makes this test actually catch that
    // format-selection regression, matching this file's "adapter logic
    // regresses -> red" claim (SDK-TEST-02/03).
    const parsedDer = secp256k1.Signature.fromDER(formatted.signature.replace(/^0x/, ''))
    expect(parsedDer.r).toBe(sig.r)
    expect(parsedDer.s).toBe(sig.s)
  })

  it('EdDSA: ephemeral ed25519 keypair signs, SDK adapter formats, signature verifies', () => {
    const privateKey = ed25519.utils.randomPrivateKey()
    const publicKey = ed25519.getPublicKey(privateKey)

    const message = new TextEncoder().encode(`vultisig-sdk-synthetic-eddsa:${Date.now()}`)
    const sig = ed25519.sign(message, privateKey) // 64 bytes: R (32) || S (32)

    const rHex = bytesToHex(sig.slice(0, 32))
    const sHex = bytesToHex(sig.slice(32, 64))
    // EdDSA signs the raw message directly (no external prehash); any stable
    // key works here since formatSignature only keys the lookup by message.
    const msgKey = `0x${bytesToHex(message)}`

    const signatureResults: Record<string, KeysignSignature> = {
      [msgKey]: {
        msg: msgKey,
        r: rHex,
        s: sHex,
        der_signature: 'unused-for-eddsa',
      },
    }

    const formatted = formatSignature(signatureResults, [msgKey], 'eddsa' satisfies SignatureAlgorithm)

    expect(formatted.format).toBe('EdDSA')
    expect(formatted.signature).toBe(rHex + sHex)
    expect(formatted.recovery).toBeUndefined()

    // Real cryptographic verification of the adapter's own output — not a shape check.
    const sigBytes = hexToBytes(formatted.signature)
    expect(ed25519.verify(sigBytes, message, publicKey)).toBe(true)
  })

  it('sanity check: a tampered signature fails verification (proves the verify path is not a no-op)', () => {
    const privateKey = secp256k1.utils.randomPrivateKey()
    const publicKey = secp256k1.getPublicKey(privateKey)
    const msgHash = sha256(new TextEncoder().encode('tamper-check'))
    const sig = secp256k1.sign(msgHash, privateKey)

    const tamperedDer = hexToBytes(sig.toDERHex())
    tamperedDer[tamperedDer.length - 1] ^= 0xff

    expect(secp256k1.verify(tamperedDer, msgHash, publicKey)).toBe(false)
  })
})
