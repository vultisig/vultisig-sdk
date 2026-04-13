import { describe, it, expect } from 'vitest'

import { _normalizeSchnorrSig } from '@vultisig/mpc-wasm'

/**
 * Regression tests for the WASM SchnorrEngine byte-order normalization.
 *
 * Background — vultisig/vultisig-sdk#252:
 *
 * The WASM `SchnorrSignSession.finish()` emits a 64-byte Ed25519 signature
 * with both the R compressed point and the S scalar in big-endian byte
 * order, while the native `@vultisig/mpc-native` engine emits the same
 * signature in canonical Ed25519 little-endian R || S order. Until #252,
 * `core/mpc/keysign/index.ts` was reversing both halves unconditionally
 * for EdDSA — which happened to match WASM but corrupted native output,
 * because reversing R (a compressed Edwards point: sign bit + y-coordinate)
 * doesn't yield another valid point. Result: every Solana / Sui / TON /
 * Cardano / Polkadot self-send through `vultiagent-app` PR #33 was failing
 * RPC `signature verification` on broadcast.
 *
 * #252 moves the normalization OUT of the shared `keysign()` loop and INTO
 * each engine's `createSignSession.finish()` wrapper, so each backend is
 * responsible for emitting canonical Ed25519 wire bytes from its own
 * `finish()`. This test pins the WASM-side normalization contract.
 */
describe('_normalizeSchnorrSig (WASM SchnorrEngine byte-order normalization)', () => {
  it('reverses R and S halves of a 64-byte Ed25519 signature', () => {
    // Distinct sentinel bytes so we can spot the half boundaries clearly:
    // R = [0x01, 0x02, ..., 0x20] (32 bytes ascending)
    // S = [0x80, 0x81, ..., 0x9f] (32 bytes ascending starting at 0x80)
    const input = new Uint8Array(64)
    for (let i = 0; i < 32; i++) input[i] = 0x01 + i
    for (let i = 0; i < 32; i++) input[32 + i] = 0x80 + i

    const out = _normalizeSchnorrSig(input)

    // R half should be reversed in place: [0x20, 0x1f, ..., 0x01]
    for (let i = 0; i < 32; i++) {
      expect(out[i]).toBe(0x20 - i)
    }
    // S half should be reversed in place: [0x9f, 0x9e, ..., 0x80]
    for (let i = 0; i < 32; i++) {
      expect(out[32 + i]).toBe(0x9f - i)
    }
  })

  it('does not cross-mix R and S — first half stays first half', () => {
    // R is all 0xAA, S is all 0xBB. After reversal, R should still be 0xAA
    // (just in reverse order, which is identical for a constant byte) and S
    // should still be 0xBB. The output should have a hard 0xAA / 0xBB boundary
    // exactly at byte 32.
    const input = new Uint8Array(64)
    input.fill(0xaa, 0, 32)
    input.fill(0xbb, 32, 64)

    const out = _normalizeSchnorrSig(input)

    for (let i = 0; i < 32; i++) {
      expect(out[i]).toBe(0xaa)
    }
    for (let i = 32; i < 64; i++) {
      expect(out[i]).toBe(0xbb)
    }
  })

  it('returns a fresh Uint8Array — does not mutate the input', () => {
    const input = new Uint8Array(64)
    for (let i = 0; i < 64; i++) input[i] = i + 1

    const snapshot = new Uint8Array(input)
    const out = _normalizeSchnorrSig(input)

    // Input is preserved
    expect(Array.from(input)).toEqual(Array.from(snapshot))
    // Output is a different buffer
    expect(out).not.toBe(input)
    expect(out.byteLength).toBe(64)
  })

  it('round-trip against itself produces the original bytes', () => {
    // R || S → reverse(R) || reverse(S) → reverse(reverse(R)) || reverse(reverse(S))
    // == R || S. This is the contract that lets WASM consumers and native
    // consumers interop through the shared keysign() loop.
    const input = new Uint8Array(64)
    for (let i = 0; i < 64; i++) input[i] = (i * 17 + 3) & 0xff

    const out = _normalizeSchnorrSig(_normalizeSchnorrSig(input))

    expect(Array.from(out)).toEqual(Array.from(input))
  })

  it('passes non-64-byte input through unchanged', () => {
    // Defensive — Ed25519 is always 64 bytes, but if some upstream change
    // emits a different length we want callers to see the raw bytes and
    // fail loudly downstream rather than us silently corrupting them.
    const short = new Uint8Array([1, 2, 3, 4])
    const long = new Uint8Array(72).fill(0x42)
    const empty = new Uint8Array(0)

    expect(_normalizeSchnorrSig(short)).toBe(short)
    expect(_normalizeSchnorrSig(long)).toBe(long)
    expect(_normalizeSchnorrSig(empty)).toBe(empty)
  })

  it('preserves a known byte vector — Ed25519 wire-format anchor', () => {
    // Lock the byte ordering to a known input/output pair so any future
    // accidental "fix" that re-introduces the buggy unconditional reverse
    // (or removes this normalization) gets caught loudly.
    //
    // Big-endian R || S (what the WASM SignSession emits):
    //   R_be = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    //   S_be = 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20
    // Canonical little-endian R || S (Ed25519 wire format):
    //   R_le = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    //   S_le = 201f1e1d1c1b1a191817161514131211100f0e0d0c0b0a090807060504030201
    const beHex =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
      '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'
    const expectedLeHex =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
      '201f1e1d1c1b1a191817161514131211100f0e0d0c0b0a090807060504030201'

    const input = Uint8Array.from(Buffer.from(beHex, 'hex'))
    const out = _normalizeSchnorrSig(input)
    const outHex = Buffer.from(out).toString('hex')

    expect(outHex).toBe(expectedLeHex)
  })
})
