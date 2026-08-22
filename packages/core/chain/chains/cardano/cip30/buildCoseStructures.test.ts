/**
 * sdk#1371: buildCoseStructures had zero test coverage. These pin the
 * CIP-8 / CIP-30 COSE_Sign1 / COSE_Key CBOR encoding against RFC 8152 /
 * RFC 8949 §3.1 by hand-computed bytes, so a future change to the CBOR
 * primitives or the header layout can't silently drift.
 */
import { describe, expect, it } from 'vitest'

import { buildCoseKey, buildCoseSign1, buildProtectedHeaderBytes, buildSigStructure } from './buildCoseStructures'
import { cborArray, cborBytes, cborText } from './cardanoCborPrimitives'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const bytesOf = (...values: number[]) => Uint8Array.from(values)

describe('buildCoseKey', () => {
  it('encodes the RFC 8152 COSE_Key map for an Ed25519 public key, byte for byte', () => {
    // 32-byte public key: 0x00, 0x01, ..., 0x1f — deterministic, not random.
    const publicKey = Uint8Array.from({ length: 32 }, (_, i) => i)

    const result = buildCoseKey({ publicKey })

    // Hand-derived per RFC 8949 §3.1 CBOR head encoding:
    //   map(4)                             -> A4
    //   1: 1        (kty: OKP)             -> 01 01
    //   3: -8       (alg: EdDSA)           -> 03 27   (negint head for -8 encodes n=7 -> 0x20|7=0x27)
    //   -1: 6       (crv: Ed25519)         -> 20 06   (negint head for -1 encodes n=0 -> 0x20|0=0x20)
    //   -2: bstr(32)(x: public key bytes)  -> 21 58 20 <32 bytes>
    const expectedHex = 'a4' + '0101' + '0327' + '2006' + '2158' + '20' + hex(publicKey)

    expect(hex(result)).toBe(expectedHex)
    expect(result.length).toBe(1 + 2 + 2 + 2 + 3 + 32)
  })

  it('embeds the public key bytes verbatim at the tail of the encoding', () => {
    const publicKey = new Uint8Array(32).fill(0xff)
    const result = buildCoseKey({ publicKey })
    expect(result.slice(-32)).toEqual(publicKey)
  })
})

describe('buildProtectedHeaderBytes / buildSigStructure / buildCoseSign1', () => {
  const addressBytes = bytesOf(0x01, 0xaa, 0xbb, 0xcc)
  const payload = bytesOf(0xde, 0xad, 0xbe, 0xef)
  const signature = new Uint8Array(64).fill(0x42)

  it('buildProtectedHeaderBytes encodes { 1: -8, "address": <bytes> } (CIP-8 §Protected Headers)', () => {
    const result = buildProtectedHeaderBytes(addressBytes)

    // map(2) -> A2
    //   1: -8            -> 01 27
    //   "address": bstr  -> 67 61646472657373 (tstr "address", 7 bytes) 44 <4 bytes> (bstr len 4)
    const addressKeyHex = hex(new TextEncoder().encode('address'))
    const expectedHex = 'a2' + '0127' + '67' + addressKeyHex + '44' + hex(addressBytes)

    expect(hex(result)).toBe(expectedHex)
  })

  it('buildSigStructure wraps ["Signature1", protected, empty_aad, payload] per RFC 8152 §4.4', () => {
    const protectedBytes = buildProtectedHeaderBytes(addressBytes)
    const result = buildSigStructure(protectedBytes, payload)

    const expected = cborArray([
      cborText('Signature1'),
      cborBytes(protectedBytes),
      cborBytes(new Uint8Array(0)),
      cborBytes(payload),
    ])

    expect(hex(result)).toBe(hex(expected))
  })

  it('buildCoseSign1 embeds the SAME protected-header bytes buildProtectedHeaderBytes returns (Sig_structure/COSE_Sign1 consistency)', () => {
    const result = buildCoseSign1({ addressBytes, payload, signature })
    const expectedProtected = buildProtectedHeaderBytes(addressBytes)

    // COSE_Sign1 = [protected: bstr, unprotected: {}, payload: bstr, signature: bstr]
    // array(4) head is 0x84; map(0) head (empty unprotected headers) is 0xA0.
    const reconstructed = concatBytes([
      Uint8Array.of(0x84),
      cborBytes(expectedProtected),
      Uint8Array.of(0xa0),
      cborBytes(payload),
      cborBytes(signature),
    ])

    expect(hex(result)).toBe(hex(reconstructed))
  })
})

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
