/**
 * Fund-safety: the address-format gate (isAddressValidForChain) must verify
 * the BCH CashAddr polymod checksum, not just the charset/length shape. A
 * single-character typo has a valid shape but a broken checksum and must be
 * rejected before it can reach a tx builder or a "valid address" UI.
 */
import { describe, expect, it } from 'vitest'

import { isAddressValidForChain } from '../../../src/utils/addressFormat'
import { isValidCashAddr } from '../../../src/utils/cashaddr'

// Canonical CashAddr vectors (reference.cash / Bitcoin ABC spec).
const VALID_P2PKH = 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'
const VALID_P2PKH_2 = 'bitcoincash:qr95sy3j9xwd2ap32xkykttr4cvcu7as4y0qverfuy'
const VALID_P2SH = 'bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq'

// Flip one interior (non-checksum) symbol to a different in-charset symbol:
// valid shape + charset, broken polymod.
function singleCharTypo(addr: string): string {
  const i = addr.indexOf(':') + 6
  const c = addr[i]!
  const repl = c === 'q' ? 'p' : 'q'
  return addr.slice(0, i) + repl + addr.slice(i + 1)
}

describe('isValidCashAddr — polymod checksum enforcement', () => {
  it('accepts valid mainnet CashAddr (P2PKH + P2SH), with and without prefix', () => {
    expect(isValidCashAddr(VALID_P2PKH)).toBe(true)
    expect(isValidCashAddr(VALID_P2PKH_2)).toBe(true)
    expect(isValidCashAddr(VALID_P2SH)).toBe(true)
    expect(isValidCashAddr(VALID_P2PKH.replace('bitcoincash:', ''))).toBe(true)
  })

  it('rejects a single-character typo (valid shape, broken checksum)', () => {
    const typo = singleCharTypo(VALID_P2PKH)
    expect(typo).not.toBe(VALID_P2PKH)
    expect(typo.length).toBe(VALID_P2PKH.length) // same shape
    expect(isValidCashAddr(typo)).toBe(false)
  })

  it('rejects charset-invalid symbols (b, i, o, 1 are NOT in cashaddr base32)', () => {
    // Splice a forbidden char into the payload keeping the length.
    const bad = VALID_P2PKH.replace(/.$/, 'b')
    expect(isValidCashAddr(bad)).toBe(false)
  })

  it('rejects wrong length and uppercase', () => {
    expect(isValidCashAddr(VALID_P2PKH + 'q')).toBe(false)
    expect(isValidCashAddr(VALID_P2PKH.toUpperCase())).toBe(false)
  })
})

describe('isAddressValidForChain gate now polymod-checks BitcoinCash', () => {
  it('accepts a valid CashAddr and rejects a typo', () => {
    expect(isAddressValidForChain(VALID_P2PKH, 'BitcoinCash')).toBe(true)
    expect(isAddressValidForChain(singleCharTypo(VALID_P2PKH), 'BitcoinCash')).toBe(false)
  })
})
