/**
 * Regression tests for CashAddr checksum verification.
 *
 * Previously the decoder stripped the 8-symbol trailing checksum via
 * `.slice(0, -8)` but never ran the polymod — so any typo in a BCH
 * address that still contained only valid base32 chars decoded to a
 * garbage pubKeyHash and signed the tx to an unrelated address.
 */
import { describe, expect, it } from 'vitest'

import { decodeAddressToPubKeyHash } from '../../../src/chains/utxo/tx'

describe('decodeAddressToPubKeyHash — CashAddr checksum', () => {
  it('accepts a well-formed CashAddr with valid checksum', () => {
    const addr = 'bitcoincash:qr95sy3j9xwd2ap32xkykttr4cvcu7as4y0qverfuy'
    const { pubKeyHash, type } = decodeAddressToPubKeyHash(addr, 'Bitcoin-Cash')
    expect(type).toBe('p2pkh')
    expect(pubKeyHash.length).toBe(20)
    // Pinned hash — regression guard against silent decoder drift.
    expect(Array.from(pubKeyHash, b => b.toString(16).padStart(2, '0')).join('')).toBe(
      'cb481232299cd5743151ac4b2d63ae198e7bb0a9'
    )
  })

  it('rejects a CashAddr with a last-char typo (valid base32, bad checksum)', () => {
    // Change final `y` → `x` — still a valid base32 symbol but the polymod
    // no longer produces 0. Before the fix, this decoded to random bytes
    // and looked like a valid P2PKH.
    const tampered = 'bitcoincash:qr95sy3j9xwd2ap32xkykttr4cvcu7as4y0qverfux'
    expect(() => decodeAddressToPubKeyHash(tampered, 'Bitcoin-Cash')).toThrow(/Cannot decode/)
  })

  it('rejects a CashAddr with mid-string transposition (valid base32, bad checksum)', () => {
    // Swap two mid-payload symbols: `y0q` → `0yq`.
    const transposed = 'bitcoincash:qr95sy3j9xwd2ap32xkykttr4cvcu7as40yqverfuy'
    expect(() => decodeAddressToPubKeyHash(transposed, 'Bitcoin-Cash')).toThrow(/Cannot decode/)
  })

  it('rejects a CashAddr with an out-of-alphabet character', () => {
    // `b` is not in the cashaddr charset ('qpzry9x8gf2tvdw0s3jn54khce6mua7l').
    const bad = 'bitcoincash:qr95sy3j9xwd2ap32xkykttr4cvcb7as4y0qverfuy'
    expect(() => decodeAddressToPubKeyHash(bad, 'Bitcoin-Cash')).toThrow(/Cannot decode/)
  })

  it('accepts a CashAddr without the prefix (auto-prefixes bitcoincash:)', () => {
    const addr = 'qr95sy3j9xwd2ap32xkykttr4cvcu7as4y0qverfuy'
    const { type } = decodeAddressToPubKeyHash(addr, 'Bitcoin-Cash')
    expect(type).toBe('p2pkh')
  })
})
