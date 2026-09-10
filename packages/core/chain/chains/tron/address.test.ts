import bs58check from 'bs58check'
import { describe, expect, it } from 'vitest'

import { decodeTronAddress } from './address'

describe('decodeTronAddress', () => {
  it.each([0x41, 0xa0])('retains all 21 payload bytes for prefix %i', prefix => {
    const payload = Uint8Array.from([prefix, ...Array.from({ length: 20 }, (_, i) => i)])
    expect(decodeTronAddress(bs58check.encode(payload))).toEqual(payload)
  })

  it.each([0, 1, 20, 22, 25])('rejects checksum-valid payload length %i', length => {
    const payload = new Uint8Array(length).fill(0x41)
    expect(() => decodeTronAddress(bs58check.encode(payload))).toThrow(/length/)
  })

  it.each([0x00, 0x42, 0xff])('rejects unsupported prefix %i', prefix => {
    const payload = new Uint8Array(21).fill(prefix)
    expect(() => decodeTronAddress(bs58check.encode(payload))).toThrow(/invalid tron address prefix/)
  })

  it.each(['', '0OIl', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6s'])('rejects malformed input %s', address => {
    expect(() => decodeTronAddress(address)).toThrow()
  })
})
