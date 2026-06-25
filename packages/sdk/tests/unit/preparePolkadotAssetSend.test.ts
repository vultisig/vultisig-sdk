import { decodeAddress } from '@polkadot/util-crypto'
import { describe, expect, it } from 'vitest'

import { POLKADOT_ASSET_HUB_KNOWN_ASSETS, preparePolkadotAssetSend } from '@/tools/prep/polkadotAssetSend'

// Well-known dev accounts (public, never funded) — Alice / Bob sr25519, but
// encoded with the POLKADOT SS58 prefix (0). The familiar `5...` forms are the
// generic-substrate prefix (42) and are now correctly REJECTED by the
// prefix-pinned decode (see the wrong-chain rejection test below). These two
// strings share the exact same 32-byte AccountId as the `5...` forms, so the
// golden callHex vectors are unchanged.
const ALICE = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5' // Alice @ Polkadot prefix 0
const BOB = '14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3' // Bob @ Polkadot prefix 0

// The original generic-substrate (prefix 42) Alice/Bob — same 32 bytes, wrong chain.
const ALICE_SUBSTRATE_42 = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const BOB_SUBSTRATE_42 = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'

// Alice's 32-byte AccountId (identical across SS58 prefixes).
const ALICE_ACCOUNT_HEX = '0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'

describe('preparePolkadotAssetSend', () => {
  it('encodes a USDT (assetId=1984) transferKeepAlive call body deterministically', () => {
    const result = preparePolkadotAssetSend({
      assetId: 1984,
      from: BOB,
      to: ALICE,
      amount: 1_000_000n, // 1 USDT @ 6 decimals
    })

    // Golden vector: pallet(0x32=50) method(0x02=2) ‖ compact(1984)=011f
    // ‖ MultiAddress::Id(0x00) ‖ Alice AccountId32 ‖ compact(1_000_000)=02093d00
    expect(result.callHex).toBe('0x3202011f00d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d02093d00')
    expect(result.chain).toBe('Polkadot')
    expect(result.action).toBe('asset_transfer')
    expect(result.assetId).toBe(1984)
    expect(result.ticker).toBe('USDT')
    expect(result.decimals).toBe(6)
    expect(result.from).toBe(BOB)
    expect(result.to).toBe(ALICE)
    expect(result.amount).toBe('1000000')
    expect(result.toAccountId).toBe(ALICE_ACCOUNT_HEX)
  })

  it('emits the exact pallet/method bytes the on-device signer validates (50/2)', () => {
    const { callHex } = preparePolkadotAssetSend({
      assetId: 1337,
      from: BOB,
      to: ALICE,
      amount: 1n,
    })
    const bytes = Buffer.from(callHex.replace(/^0x/, ''), 'hex')
    // pallet_assets.transferKeepAlive — must match assertAssetTransferCallHex.
    expect(bytes[0]).toBe(50)
    expect(bytes[1]).toBe(2)
    // MultiAddress::Id discriminant after compact(assetId=1337 -> 2 bytes).
    expect(bytes[4]).toBe(0x00)
  })

  it('defaults ticker/decimals for USDC (assetId=1337)', () => {
    const result = preparePolkadotAssetSend({ assetId: 1337, from: BOB, to: ALICE, amount: 5n })
    expect(result.ticker).toBe('USDC')
    expect(result.decimals).toBe(6)
    expect(POLKADOT_ASSET_HUB_KNOWN_ASSETS[1337]).toEqual({ ticker: 'USDC', decimals: 6 })
  })

  it('embeds the recipient AccountId32 decoded from the SS58 address', () => {
    const result = preparePolkadotAssetSend({ assetId: 1984, from: BOB, to: ALICE, amount: 10n })
    const bytes = Buffer.from(result.callHex.replace(/^0x/, ''), 'hex')
    // compact(1984) is 2 bytes -> account starts at offset 2 + 2 + 1 (MultiAddress::Id) = 5.
    const account = bytes.subarray(5, 5 + 32)
    // Decode the prefix-pinned (Polkadot, 0) form of the destination.
    expect('0x' + account.toString('hex')).toBe('0x' + Buffer.from(decodeAddress(ALICE, false, 0)).toString('hex'))
  })

  it('accepts unknown asset ids (no hardcoded registry gate) without ticker/decimals', () => {
    const result = preparePolkadotAssetSend({ assetId: 4242, from: BOB, to: ALICE, amount: 7n })
    expect(result.assetId).toBe(4242)
    expect(result.ticker).toBeUndefined()
    expect(result.decimals).toBeUndefined()
    const bytes = Buffer.from(result.callHex.replace(/^0x/, ''), 'hex')
    expect(bytes[0]).toBe(50)
    expect(bytes[1]).toBe(2)
  })

  it('honours explicit ticker/decimals overrides', () => {
    const result = preparePolkadotAssetSend({
      assetId: 4242,
      from: BOB,
      to: ALICE,
      amount: 7n,
      ticker: 'FOO',
      decimals: 8,
    })
    expect(result.ticker).toBe('FOO')
    expect(result.decimals).toBe(8)
  })

  it('rejects a zero / negative amount', () => {
    expect(() => preparePolkadotAssetSend({ assetId: 1984, from: BOB, to: ALICE, amount: 0n })).toThrow(
      /greater than zero/
    )
    expect(() => preparePolkadotAssetSend({ assetId: 1984, from: BOB, to: ALICE, amount: -1n })).toThrow(
      /greater than zero/
    )
  })

  it('rejects non-u32 / non-positive asset ids', () => {
    expect(() => preparePolkadotAssetSend({ assetId: 0, from: BOB, to: ALICE, amount: 1n })).toThrow(
      /Invalid Polkadot asset id/
    )
    expect(() => preparePolkadotAssetSend({ assetId: 0x1_0000_0000, from: BOB, to: ALICE, amount: 1n })).toThrow(
      /Invalid Polkadot asset id/
    )
    expect(() => preparePolkadotAssetSend({ assetId: 1.5, from: BOB, to: ALICE, amount: 1n })).toThrow(
      /Invalid Polkadot asset id/
    )
  })

  it('rejects asset ids in compact big-integer mode (>= 2^30) the signer would refuse', () => {
    // 2^30 - 1 is the largest non-big-integer compact and is accepted.
    const ok = preparePolkadotAssetSend({ assetId: 0x3fffffff, from: BOB, to: ALICE, amount: 1n })
    expect(ok.assetId).toBe(0x3fffffff)
    // The compact(assetId) leading byte must NOT be big-integer mode (low 2 bits 0b11).
    const okBytes = Buffer.from(ok.callHex.replace(/^0x/, ''), 'hex')
    expect(okBytes[2]! & 0x03).not.toBe(0x03)
    // 2^30 tips into compact big-integer mode -> assertAssetTransferCallHex refuses it,
    // so the builder must reject it up front rather than emit an un-signable callHex.
    expect(() => preparePolkadotAssetSend({ assetId: 0x4000_0000, from: BOB, to: ALICE, amount: 1n })).toThrow(
      /Invalid Polkadot asset id/
    )
  })

  it('rejects a malformed destination address (bad SS58 checksum)', () => {
    expect(() => preparePolkadotAssetSend({ assetId: 1984, from: BOB, to: 'not-an-address', amount: 1n })).toThrow(
      /Invalid destination Polkadot address/
    )
  })

  it('requires a sender address', () => {
    expect(() => preparePolkadotAssetSend({ assetId: 1984, from: '', to: ALICE, amount: 1n })).toThrow(/Sender address/)
  })

  // ── Wrong-chain / EVM-hex recipient guard (audit P1) ────────────────────────

  it('rejects a wrong-chain (non-Polkadot prefix) SS58 destination', () => {
    // Generic-substrate (prefix 42) Alice — same 32 bytes, different chain.
    // Without the prefix pin this would silently route funds to the same-bytes
    // Polkadot account. decodeAddress(addr, false, 0) throws "Expected
    // ss58Format 0, received 42".
    expect(() => preparePolkadotAssetSend({ assetId: 1984, from: BOB, to: ALICE_SUBSTRATE_42, amount: 1n })).toThrow(
      /Invalid destination Polkadot address/
    )
  })

  it('rejects a wrong-chain (non-Polkadot prefix) SS58 sender', () => {
    expect(() => preparePolkadotAssetSend({ assetId: 1984, from: BOB_SUBSTRATE_42, to: ALICE, amount: 1n })).toThrow(
      /Invalid sender Polkadot address/
    )
  })

  it('rejects an EVM-hex destination (even a 32-byte hex that decodeAddress would otherwise accept)', () => {
    // 20-byte EVM address.
    expect(() =>
      preparePolkadotAssetSend({
        assetId: 1984,
        from: BOB,
        to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        amount: 1n,
      })
    ).toThrow(/looks like an EVM\/hex address/)
    // 32-byte hex — decodeAddress(hex, false, 0) SUCCEEDS in polkadot.js, so the
    // explicit EVM-hex reject (not the prefix pin) is what catches this.
    expect(() =>
      preparePolkadotAssetSend({
        assetId: 1984,
        from: BOB,
        to: ALICE_ACCOUNT_HEX,
        amount: 1n,
      })
    ).toThrow(/looks like an EVM\/hex address/)
  })

  it('rejects an EVM-hex sender', () => {
    expect(() =>
      preparePolkadotAssetSend({
        assetId: 1984,
        from: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        to: ALICE,
        amount: 1n,
      })
    ).toThrow(/looks like an EVM\/hex address/)
  })

  it('accepts a canonical Polkadot (prefix 0) destination round-trip', () => {
    const result = preparePolkadotAssetSend({ assetId: 1984, from: BOB, to: ALICE, amount: 1n })
    // toAccountId is the raw 32-byte AccountId — identical whether the input was
    // prefix 0 or prefix 42, proving the pin only gates the chain, not the bytes.
    expect(result.toAccountId).toBe(ALICE_ACCOUNT_HEX)
  })
})
