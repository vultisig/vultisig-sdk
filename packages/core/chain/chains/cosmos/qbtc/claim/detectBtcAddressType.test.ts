import { describe, expect, it } from 'vitest'

import { detectBtcAddressType } from './detectBtcAddressType'

describe('detectBtcAddressType', () => {
  it('detects P2PKH addresses starting with 1', () => {
    expect(detectBtcAddressType('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(
      'p2pkh'
    )
  })

  it('detects P2SH-P2WPKH addresses starting with 3', () => {
    expect(detectBtcAddressType('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(
      'p2sh-p2wpkh'
    )
  })

  it('detects P2WPKH addresses (bc1q, 42 chars)', () => {
    const addr = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
    expect(addr.length).toBe(42)
    expect(detectBtcAddressType(addr)).toBe('p2wpkh')
  })

  it('detects P2WSH addresses (bc1q, 62 chars)', () => {
    const addr =
      'bc1qft5p2uhsdcdc3l2ua4ap5qqfg4pjaqlp250x7us7a8qqhrxrxfsqseac85'
    expect(addr.length).toBe(62)
    expect(detectBtcAddressType(addr)).toBe('p2wsh')
  })

  it('detects long bc1q addresses as P2WSH', () => {
    // Any bc1q address longer than 42 chars is P2WSH
    const addr =
      'bc1qrp33g0q5b5698ahp5jnf017nmnzs75rz9eeee5946d7jjk37n4w4qschxhz'
    expect(addr.length).toBeGreaterThan(42)
    expect(detectBtcAddressType(addr)).toBe('p2wsh')
  })

  it('detects P2TR addresses starting with bc1p', () => {
    expect(
      detectBtcAddressType(
        'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'
      )
    ).toBe('p2tr')
  })

  it('throws for unsupported address format', () => {
    expect(() => detectBtcAddressType('tb1qtest')).toThrow(
      'Unsupported Bitcoin address format'
    )
  })
})
