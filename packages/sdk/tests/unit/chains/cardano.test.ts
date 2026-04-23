/**
 * Byte-parity tests for the Cardano RN bridge.
 *
 * Cardano txs are sensitive to CBOR encoding shape — key ordering, integer
 * width, tagging — so any re-encoding of the body would invalidate the
 * signature. These tests pin the wire format of the three primitives the
 * RN bridge re-exports.
 */
import { blake2b } from '@noble/hashes/blake2b'
import { describe, expect, it } from 'vitest'

import {
  buildCardanoWitnessSet,
  buildSignedCardanoTx,
  cardanoTxBodyHash,
} from '../../../src/platforms/react-native/chains/cardano'

const bytesToHex = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0')
  return s
}

const hexToBytes = (h: string): Uint8Array => {
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

const PUB_KEY = new Uint8Array(32).fill(0x11)
const SIGNATURE = new Uint8Array(64).fill(0x22)

describe('cardano / buildCardanoWitnessSet', () => {
  it('emits spec-conformant CIP-30 witness set CBOR', () => {
    const witness = buildCardanoWitnessSet({ publicKey: PUB_KEY, signature: SIGNATURE })

    // a1                       map(1)
    //   00                     uint(0)  — vkey_witness key
    //   81                     array(1)
    //     82                   array(2)
    //       5820 <32*11>       bytes(32)
    //       5840 <64*22>       bytes(64)
    const expected = 'a10081825820' + '11'.repeat(32) + '5840' + '22'.repeat(64)

    expect(bytesToHex(witness)).toBe(expected)
  })
})

// Minimal valid Shelley-era tx body: a map with one entry (fee => 0).
// a1 02 00 = map(1) { 2: 0 } — "02" is the CBOR key for `fee`.
const MINIMAL_BODY_HEX = 'a10200'

describe('cardano / buildSignedCardanoTx', () => {
  it('wraps a pre-signed body with witness + is_valid=true + null aux', () => {
    const txBodyCbor = hexToBytes(MINIMAL_BODY_HEX)
    const signed = buildSignedCardanoTx({
      txBodyCbor,
      publicKey: PUB_KEY,
      signature: SIGNATURE,
    })

    // 84                         array(4)
    //   <body bytes verbatim>    a1 02 00
    //   <witness set>             a1 00 81 82 5820 <pk> 5840 <sig>
    //   f5                        true
    //   f6                        null
    const expected = '84' + MINIMAL_BODY_HEX + 'a10081825820' + '11'.repeat(32) + '5840' + '22'.repeat(64) + 'f5' + 'f6'

    expect(bytesToHex(signed)).toBe(expected)
  })

  it('embeds body bytes verbatim without re-encoding', () => {
    // Body bytes that would round-trip differently through cbor-x if decoded
    // and re-encoded (text-keyed map with a single-byte uint). Covers the
    // "re-encoding could change key ordering or integer widths" invariant
    // in the buildSignedCardanoTx module docstring.
    const txBodyCbor = hexToBytes('a1626869182a') // { "hi": 42 } — text key, uint(42) as two bytes
    const signed = buildSignedCardanoTx({
      txBodyCbor,
      publicKey: PUB_KEY,
      signature: SIGNATURE,
    })

    expect(bytesToHex(signed).startsWith('84' + 'a1626869182a')).toBe(true)
  })
})

describe('cardano / cardanoTxBodyHash', () => {
  it('returns blake2b-256 of the body bytes, not of the full tx', () => {
    const body = hexToBytes(MINIMAL_BODY_HEX)
    const tx = new Uint8Array([
      0x84,
      ...body,
      ...buildCardanoWitnessSet({ publicKey: PUB_KEY, signature: SIGNATURE }),
      0xf5,
      0xf6,
    ])

    const hash = cardanoTxBodyHash(bytesToHex(tx))
    const expected = blake2b(body, { dkLen: 32 })

    expect(bytesToHex(hash)).toBe(bytesToHex(expected))
  })
})
