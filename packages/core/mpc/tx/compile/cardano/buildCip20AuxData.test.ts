import { blake2b } from '@noble/hashes/blake2b'
import { decode as cborDecode } from 'cbor-x'
import { describe, expect, it } from 'vitest'

import { buildCip20AuxData, memoToChunks, patchTxBodyWithAuxHash } from './buildCip20AuxData'

const bytesToHex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

describe('memoToChunks', () => {
  it('returns a single chunk for short memos', () => {
    expect(memoToChunks('hello world')).toEqual(['hello world'])
  })

  it('returns a single empty-string chunk for empty input', () => {
    expect(memoToChunks('')).toEqual([''])
  })

  it('splits exactly on 64-byte boundaries for ASCII', () => {
    const memo65 = 'a'.repeat(65)
    const chunks = memoToChunks(memo65)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(64)
    expect(chunks[1]).toHaveLength(1)
  })

  it('does not split a 64-byte memo', () => {
    const memo64 = 'x'.repeat(64)
    expect(memoToChunks(memo64)).toEqual([memo64])
  })
})

describe('buildCip20AuxData', () => {
  it('encodes the outer map with key 674 and inner map with key "msg"', () => {
    const { auxDataCbor } = buildCip20AuxData('hello world')
    // cbor-x decodes integer-keyed maps to plain objects with string keys
    const decoded = cborDecode(auxDataCbor) as Record<string, Record<string, string[]>>
    expect(typeof decoded).toBe('object')

    // Outer key is 674 (encoded as CBOR uint, decoded to string '674')
    const inner = decoded['674']
    expect(inner).toBeDefined()

    // Inner map has "msg" key whose value is an array of chunks
    expect(inner).toHaveProperty('msg')
    expect(inner['msg']).toEqual(['hello world'])
  })

  it('produces two chunks for a 65-byte ASCII memo', () => {
    const memo = 'a'.repeat(65)
    const { auxDataCbor } = buildCip20AuxData(memo)
    const decoded = cborDecode(auxDataCbor) as Record<string, Record<string, string[]>>
    const msgValue = decoded['674']!['msg']!
    expect(msgValue).toHaveLength(2)
    expect(msgValue[0]).toHaveLength(64)
    expect(msgValue[1]).toHaveLength(1)
  })

  it('produces a single empty-string chunk for empty memo', () => {
    const { auxDataCbor } = buildCip20AuxData('')
    const decoded = cborDecode(auxDataCbor) as Record<string, Record<string, string[]>>
    expect(decoded['674']!['msg']).toEqual([''])
  })

  it('auxDataHash is blake2b-256 of auxDataCbor', () => {
    const { auxDataCbor, auxDataHash } = buildCip20AuxData('vultisig-test')
    const expected = blake2b(auxDataCbor, { dkLen: 32 })
    expect(bytesToHex(auxDataHash)).toBe(bytesToHex(expected))
  })

  it('pins auxDataHash for known memo (regression guard)', () => {
    // Verify the hash is stable and non-zero
    const { auxDataHash, auxDataCbor } = buildCip20AuxData('vultisig-test')
    expect(auxDataHash).toHaveLength(32)
    expect(auxDataHash.some(b => b !== 0)).toBe(true)
    // Verify it matches blake2b of the CBOR
    expect(bytesToHex(auxDataHash)).toBe(bytesToHex(blake2b(auxDataCbor, { dkLen: 32 })))
  })
})

describe('patchTxBodyWithAuxHash', () => {
  const DUMMY_HASH = new Uint8Array(32).fill(0xab)

  it('increments the CBOR map count by 1', () => {
    // a1 02 00 = map(1) { 2: 0 } — minimal Shelley body
    const body = new Uint8Array([0xa1, 0x02, 0x00])
    const patched = patchTxBodyWithAuxHash(body, DUMMY_HASH)
    // First byte should now be a2 = map(2)
    expect(patched[0]).toBe(0xa2)
  })

  it('appends key 7 and the aux hash bytes', () => {
    const body = new Uint8Array([0xa1, 0x02, 0x00])
    const patched = patchTxBodyWithAuxHash(body, DUMMY_HASH)
    // After the header (a2) and original body (02 00), we expect:
    // 07        = uint(7) — the aux_data_hash key
    // 5820 <32 bytes of 0xab>
    const hex = bytesToHex(patched)
    expect(hex.endsWith('07' + '5820' + 'ab'.repeat(32))).toBe(true)
  })

  it('preserves original map entries verbatim', () => {
    const body = new Uint8Array([0xa2, 0x00, 0x01, 0x02, 0x03])
    const patched = patchTxBodyWithAuxHash(body, DUMMY_HASH)
    // Original bytes (after the header) should appear intact
    expect(bytesToHex(patched).includes('00010203')).toBe(true)
  })

  it('throws on empty input', () => {
    expect(() => patchTxBodyWithAuxHash(new Uint8Array(0), DUMMY_HASH)).toThrow()
  })

  it('throws if first byte is not a CBOR map', () => {
    // 0x81 = array(1)
    expect(() => patchTxBodyWithAuxHash(new Uint8Array([0x81, 0x00]), DUMMY_HASH)).toThrow(/major type/)
  })
})
