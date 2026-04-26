/**
 * Regression tests for P2SH version-byte detection in
 * `decodeAddressToPubKeyHash`.
 *
 * Previously the base58check fallback returned `type: 'p2pkh'` for every
 * decoded address, so a Bitcoin `3...` deposit address (P2SH, version 0x05)
 * silently re-encoded to a P2PKH locking script. Funds sent to that script
 * would not unlock the recipient's actual P2SH redeem script and would be
 * stuck under a hash matching no spendable key.
 *
 * Pinned hashes verify the decoder's pubKeyHash slice — drift would silently
 * change the bytes the locking script commits to.
 */
import bs58check from 'bs58check'
import { describe, expect, it } from 'vitest'

import { decodeAddressToPubKeyHash } from '../../../src/chains/utxo/tx'

const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

// Build a base58check address from a single version byte + 20-byte hash so we
// can exercise each P2SH version constant directly without hunting real-world
// addresses for every chain.
const synthAddress = (version: number, hash20Hex: string): string => {
  const hash = Uint8Array.from(hash20Hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const payload = new Uint8Array(21)
  payload[0] = version
  payload.set(hash, 1)
  return bs58check.encode(payload)
}

const HASH_20 = '0102030405060708090a0b0c0d0e0f1011121314'

describe('decodeAddressToPubKeyHash — P2SH version-byte detection', () => {
  it('decodes Bitcoin P2SH (3...) as type p2sh (version 0x05)', () => {
    // 35hK24tcLEWcgNA4JxpvbkNkoAcDGqQPsP — sample BTC P2SH address.
    const addr = '35hK24tcLEWcgNA4JxpvbkNkoAcDGqQPsP'
    const { type, pubKeyHash } = decodeAddressToPubKeyHash(addr, 'Bitcoin')
    expect(type).toBe('p2sh')
    expect(pubKeyHash.length).toBe(20)
    // Pinned hash — regression guard against silent decoder drift.
    expect(hex(pubKeyHash)).toBe('2beec605c9a6512f55fe93ad76753e24fc8579b0')
  })

  it('decodes Bitcoin P2PKH (1...) as type p2pkh (version 0x00)', () => {
    // 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa — Satoshi's genesis output address
    const addr = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
    const { type, pubKeyHash } = decodeAddressToPubKeyHash(addr, 'Bitcoin')
    expect(type).toBe('p2pkh')
    expect(hex(pubKeyHash)).toBe('62e907b15cbf27d5425399ebf6f0fb50ebb88f18')
  })

  // Synthetic addresses for each documented P2SH version byte. Constructing
  // via bs58check.encode keeps the test independent of address-format trivia
  // (which prefix letter each network actually emits) and exercises only the
  // version-byte → script-type mapping.
  it('decodes Litecoin P2SH version 0x32 as type p2sh', () => {
    const addr = synthAddress(0x32, HASH_20)
    const { type, pubKeyHash } = decodeAddressToPubKeyHash(addr, 'Litecoin')
    expect(type).toBe('p2sh')
    expect(hex(pubKeyHash)).toBe(HASH_20)
  })

  it('decodes Litecoin P2PKH version 0x30 as type p2pkh', () => {
    const addr = synthAddress(0x30, HASH_20)
    const { type } = decodeAddressToPubKeyHash(addr, 'Litecoin')
    expect(type).toBe('p2pkh')
  })

  it('decodes Dogecoin P2SH version 0x16 as type p2sh', () => {
    const addr = synthAddress(0x16, HASH_20)
    const { type, pubKeyHash } = decodeAddressToPubKeyHash(addr, 'Dogecoin')
    expect(type).toBe('p2sh')
    expect(hex(pubKeyHash)).toBe(HASH_20)
  })

  it('decodes Dogecoin P2PKH version 0x1e as type p2pkh', () => {
    const addr = synthAddress(0x1e, HASH_20)
    const { type } = decodeAddressToPubKeyHash(addr, 'Dogecoin')
    expect(type).toBe('p2pkh')
  })

  it('decodes Dash P2SH version 0x10 as type p2sh', () => {
    const addr = synthAddress(0x10, HASH_20)
    const { type, pubKeyHash } = decodeAddressToPubKeyHash(addr, 'Dash')
    expect(type).toBe('p2sh')
    expect(hex(pubKeyHash)).toBe(HASH_20)
  })
})

describe('locking script for P2SH outputs (smoke through buildUtxoSendTx)', () => {
  it('produces OP_HASH160 <hash> OP_EQUAL for a P2SH destination', async () => {
    // We import buildUtxoSendTx lazily so the top-level decoder tests stay
    // focused on the address-decode boundary; this asserts that the new
    // 'p2sh' kind plumbs through to a valid locking-script shape.
    const { buildUtxoSendTx } = await import('../../../src/chains/utxo/tx')
    const compressedPubKey = new Uint8Array(33)
    compressedPubKey[0] = 0x02
    const result = buildUtxoSendTx({
      chain: 'Bitcoin',
      // Sender is a regular bech32 P2WPKH address (real Vultisig vaults are P2PKH/P2WPKH).
      fromAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      // Destination is a real P2SH (3...) address.
      toAddress: '35hK24tcLEWcgNA4JxpvbkNkoAcDGqQPsP',
      amount: 100_000n,
      utxos: [{ hash: '00'.repeat(32), index: 0, value: 200_000n }],
      feeRate: 1,
      compressedPubKey,
    })
    // The unsigned raw bytes embed the locking script for the destination.
    // Look for `a9 14 <20-byte-hash> 87` (P2SH script) — pinned hash above.
    expect(result.unsignedRawHex).toContain('a9142beec605c9a6512f55fe93ad76753e24fc8579b087')
    // Must NOT contain the P2PKH locking script for the same hash, which
    // would be the pre-fix bug shape `76 a9 14 <hash> 88 ac`.
    expect(result.unsignedRawHex).not.toContain('76a9142beec605c9a6512f55fe93ad76753e24fc8579b088ac')
  })
})
