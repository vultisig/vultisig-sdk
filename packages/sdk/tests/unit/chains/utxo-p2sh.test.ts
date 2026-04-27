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

  // BCH CashAddr P2SH (`bitcoincash:p...`). The CashAddr type byte for P2SH
  // is 0x08 (high nibble of result[0]); without an explicit branch, the
  // decoder fell through to the bottom-of-function `Cannot decode` throw —
  // we'd reject every BCH P2SH deposit with no diagnostic. Worse, if the
  // fallthrough were ever made silent, a P2SH address would re-encode as
  // P2PKH and lock funds.
  it('decodes BCH CashAddr P2SH (bitcoincash:p...) as type p2sh', () => {
    // Real-world BCH CashAddr P2SH encoding produced by the reference
    // bchaddrjs implementation for hash20 = 'cb481232' + zero-pad.
    //
    // We construct the fixture address from the same primitives the SDK
    // uses (CHARSET + 5-bit→8-bit pack + polymod) so the test is fully
    // self-contained and doesn't pull in @ton-style libraries.
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    const buildCashAddr = (typeByte: number, hash20: Uint8Array): string => {
      const versionByte = typeByte // 0x00 P2PKH, 0x08 P2SH
      const payload8 = new Uint8Array(21)
      payload8[0] = versionByte
      payload8.set(hash20, 1)
      // pack 8-bit → 5-bit
      const data5: number[] = []
      let acc = 0
      let bits = 0
      for (const b of payload8) {
        acc = (acc << 8) | b
        bits += 8
        while (bits >= 5) {
          bits -= 5
          data5.push((acc >> bits) & 0x1f)
        }
      }
      if (bits > 0) data5.push((acc << (5 - bits)) & 0x1f)
      // checksum (cashaddr polymod over [prefixLower5, 0, data5, 0,0,0,0,0,0,0,0])
      const prefixLower5 = Array.from('bitcoincash', c => c.charCodeAt(0) & 0x1f)
      const values = [...prefixLower5, 0, ...data5, 0, 0, 0, 0, 0, 0, 0, 0]
      const GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n]
      let chk = 1n
      for (const v of values) {
        const top = chk >> 35n
        chk = ((chk & 0x07ffffffffn) << 5n) ^ BigInt(v)
        for (let i = 0; i < 5; i++) {
          if ((top >> BigInt(i)) & 1n) chk ^= GEN[i]!
        }
      }
      const polymod = chk ^ 1n
      const checksum5: number[] = []
      for (let i = 0; i < 8; i++) {
        checksum5.push(Number((polymod >> BigInt(5 * (7 - i))) & 0x1fn))
      }
      const fullData5 = [...data5, ...checksum5]
      const payload = fullData5.map(d => CHARSET[d]).join('')
      return `bitcoincash:${payload}`
    }

    const hash20 = Uint8Array.from(HASH_20.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    const p2shAddr = buildCashAddr(0x08, hash20)
    expect(p2shAddr.startsWith('bitcoincash:p')).toBe(true)

    const { type, pubKeyHash } = decodeAddressToPubKeyHash(p2shAddr, 'Bitcoin-Cash')
    expect(type).toBe('p2sh')
    expect(hex(pubKeyHash)).toBe(HASH_20)

    // And confirm P2PKH still works alongside the new branch.
    const p2pkhAddr = buildCashAddr(0x00, hash20)
    expect(p2pkhAddr.startsWith('bitcoincash:q')).toBe(true)
    const p2pkh = decodeAddressToPubKeyHash(p2pkhAddr, 'Bitcoin-Cash')
    expect(p2pkh.type).toBe('p2pkh')
    expect(hex(p2pkh.pubKeyHash)).toBe(HASH_20)
  })
})

describe('buildUtxoSendTx — rejects P2SH fromAddress (CR item #6 follow-up)', () => {
  // The decoder accepts BCH `bitcoincash:p...` (CashAddr P2SH, type byte
  // 0x08) and BTC/LTC/DOGE/DASH base58 P2SH (version 0x05/0x32/0x16/0x10),
  // which is correct for `toAddress`. But `fromAddress` decoding to P2SH
  // would silently route through the P2PKH/P2WPKH-shaped sighash path —
  // signing garbage that won't broadcast. Vultisig vaults derive only
  // P2PKH/P2WPKH addresses, so any P2SH `fromAddress` is a caller bug;
  // `buildUtxoSendTx` must throw fast rather than build an invalid spend.
  it('throws when fromAddress decodes to P2SH (BTC 3...)', async () => {
    const { buildUtxoSendTx } = await import('../../../src/chains/utxo/tx')
    const compressedPubKey = new Uint8Array(33)
    compressedPubKey[0] = 0x02
    expect(() =>
      buildUtxoSendTx({
        chain: 'Bitcoin',
        fromAddress: '35hK24tcLEWcgNA4JxpvbkNkoAcDGqQPsP', // BTC P2SH (3...)
        toAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        amount: 100_000n,
        utxos: [{ hash: '00'.repeat(32), index: 0, value: 200_000n }],
        feeRate: 1,
        compressedPubKey,
      })
    ).toThrow(/P2SH spending is not supported/)
  })

  it('throws when fromAddress decodes to DOGE P2SH (A.../version 0x16)', async () => {
    const { buildUtxoSendTx } = await import('../../../src/chains/utxo/tx')
    const compressedPubKey = new Uint8Array(33)
    compressedPubKey[0] = 0x02
    // Synthetic DOGE P2SH `from` address — `to` is a valid DOGE P2PKH so
    // we hit the P2SH-from guard before any other decode/encode path.
    const dogeP2shAddr = synthAddress(0x16, HASH_20)
    expect(() =>
      buildUtxoSendTx({
        chain: 'Dogecoin',
        fromAddress: dogeP2shAddr,
        toAddress: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L', // valid DOGE P2PKH
        amount: 100_000n,
        utxos: [{ hash: '00'.repeat(32), index: 0, value: 200_000n }],
        feeRate: 1,
        compressedPubKey,
      })
    ).toThrow(/P2SH spending is not supported/)
  })
})

describe('buildUtxoSendTx — fromDec.type vs spec.scriptType cross-type guard (CR R7 #14)', () => {
  // The chain config pins exactly one scriptType per chain (BTC=p2wpkh,
  // DOGE=p2pkh, etc). The decoder is permissive — it accepts legacy `1...`
  // (P2PKH) or segwit `bc1q...` (P2WPKH) for Bitcoin equally. Without an
  // explicit cross-type guard, a legacy-from on a segwit chain would route
  // through the WRONG sighash variant (legacy-style, not BIP143) and emit a
  // hash that signs garbage — broadcast-time failure, no diagnostic.
  it('throws when fromAddress is BTC P2PKH (1...) but chain expects p2wpkh', async () => {
    const { buildUtxoSendTx } = await import('../../../src/chains/utxo/tx')
    const compressedPubKey = new Uint8Array(33)
    compressedPubKey[0] = 0x02
    expect(() =>
      buildUtxoSendTx({
        chain: 'Bitcoin', // spec.scriptType = 'p2wpkh'
        fromAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // Satoshi's P2PKH
        toAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        amount: 100_000n,
        utxos: [{ hash: '00'.repeat(32), index: 0, value: 200_000n }],
        feeRate: 1,
        compressedPubKey,
      })
    ).toThrow(/decodes to p2pkh but chain Bitcoin expects p2wpkh/)
  })

  // Note: the matching-scriptType happy path is already exercised by the
  // existing 'locking script for P2SH outputs' test below (BTC + bc1q...).
})

describe('decodeAddressToPubKeyHash — P2WSH rejection (32-byte witness v0)', () => {
  // P2WSH addresses (`bc1q...` 62-char) carry a 32-byte witness program.
  // The previous decoder branch returned `{type: 'p2wpkh'}` regardless of
  // program length, so the SDK would build an OP_0 <32-byte> locking
  // script and a P2WPKH-shaped sighash that can't be unlocked — funds
  // permanently stuck. We reject explicitly until P2WSH spend support
  // ships.
  it('throws on Bitcoin P2WSH (32-byte witness v0)', () => {
    // Real-world P2WSH from the BIP-141 spec example (script hash of
    // OP_1 OP_CHECKSIG-equivalent test vector).
    const p2wshAddr = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'
    expect(() => decodeAddressToPubKeyHash(p2wshAddr, 'Bitcoin')).toThrow(/P2WSH/)
  })

  it('still accepts Bitcoin P2WPKH (20-byte witness v0)', () => {
    const p2wpkhAddr = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
    const { type, pubKeyHash } = decodeAddressToPubKeyHash(p2wpkhAddr, 'Bitcoin')
    expect(type).toBe('p2wpkh')
    expect(pubKeyHash.length).toBe(20)
  })
})

describe('decodeAddressToPubKeyHash — wrong-chain paste rejects 21-byte payload (CR R8 #1)', () => {
  // Pre-fix: a Zcash t-address (2-byte version `0x1c, 0xb8` + 20-byte hash =
  // 22-byte total payload) decoded under chain='Dogecoin' bypassed the Zcash
  // branch (chain check), missed P2SH_VERSIONS (0x1c is not in the set), and
  // fell through to `return { pubKeyHash: decoded.slice(1), type: 'p2pkh' }`
  // with a 21-byte pubKeyHash. `buildScriptPubKey` hardcodes `OP_PUSH_20` so
  // the resulting `76 a9 14 <20 bytes> <leftover> 88 ac` locking script is
  // non-standard and unspendable — funds sent to it lock permanently.
  // The decoder now throws when the post-version slice isn't exactly 20 bytes.
  const buildZcashTAddress = (versionLowByte: number, hash20Hex: string): string => {
    const hash = Uint8Array.from(hash20Hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    const payload = new Uint8Array(22)
    payload[0] = 0x1c
    payload[1] = versionLowByte
    payload.set(hash, 2)
    return bs58check.encode(payload)
  }

  it('throws when a Zcash t1-address is decoded as Dogecoin (22-byte payload → 21-byte slice)', () => {
    const zcashTAddr = buildZcashTAddress(0xb8, HASH_20) // t1...
    expect(() => decodeAddressToPubKeyHash(zcashTAddr, 'Dogecoin')).toThrow(
      /payload length 21 bytes for chain Dogecoin/
    )
  })

  it('throws when a Zcash t1-address is decoded as Bitcoin-Cash', () => {
    const zcashTAddr = buildZcashTAddress(0xb8, HASH_20)
    // Note: BCH branch is CashAddr (`bitcoincash:...`); a base58 t-address
    // doesn't match the CashAddr prefix, so it falls into the base58 fallback
    // exactly as the Dogecoin case does.
    expect(() => decodeAddressToPubKeyHash(zcashTAddr, 'Bitcoin-Cash')).toThrow(
      /payload length 21 bytes for chain Bitcoin-Cash/
    )
  })

  it('throws when a Zcash t1-address is decoded as Dash', () => {
    const zcashTAddr = buildZcashTAddress(0xb8, HASH_20)
    expect(() => decodeAddressToPubKeyHash(zcashTAddr, 'Dash')).toThrow(
      /payload length 21 bytes for chain Dash/
    )
  })

  it('still decodes a Zcash t1-address normally under chain=Zcash (Zcash branch handles before fallback)', () => {
    const zcashTAddr = buildZcashTAddress(0xb8, HASH_20)
    const { type, pubKeyHash } = decodeAddressToPubKeyHash(zcashTAddr, 'Zcash')
    expect(type).toBe('p2pkh')
    expect(pubKeyHash.length).toBe(20)
    expect(hex(pubKeyHash)).toBe(HASH_20)
  })

  it('still decodes a Zcash t3-address (P2SH) normally under chain=Zcash', () => {
    const zcashT3Addr = buildZcashTAddress(0xbd, HASH_20) // t3...
    const { type, pubKeyHash } = decodeAddressToPubKeyHash(zcashT3Addr, 'Zcash')
    expect(type).toBe('p2sh')
    expect(pubKeyHash.length).toBe(20)
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
