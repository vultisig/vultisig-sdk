import { _normalizeSchnorrSig } from '@vultisig/mpc-wasm'
import { describe, expect, it } from 'vitest'

describe('_normalizeSchnorrSig (WASM SchnorrEngine byte-order normalization)', () => {
  it('preserves canonical R and S byte order', () => {
    const input = new Uint8Array(64)
    for (let i = 0; i < 32; i++) input[i] = 0x01 + i
    for (let i = 0; i < 32; i++) input[32 + i] = 0x80 + i

    const out = _normalizeSchnorrSig(input)

    expect(out).toEqual(input)
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

  it('preserves a known canonical Ed25519 wire-format vector', () => {
    const canonicalHex =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
      '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'

    const input = Uint8Array.from(Buffer.from(canonicalHex, 'hex'))
    const out = _normalizeSchnorrSig(input)
    const outHex = Buffer.from(out).toString('hex')

    expect(outHex).toBe(canonicalHex)
  })
})
