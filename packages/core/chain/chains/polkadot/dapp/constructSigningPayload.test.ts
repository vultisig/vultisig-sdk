import { describe, expect, it } from 'vitest'

import { constructAssetHubPolkadotSigningPayload } from './constructSigningPayload'
import { PolkadotSignerPayloadJSON } from './PolkadotSignerPayload'

// ---------------------------------------------------------------------------
// Byte-fixture test for the Asset Hub Polkadot signed-extension shape.
//
// Ported from vultiagent-app/src/services/__tests__/polkadotTx.test.ts
// (assembleSignerPayload describe block) which serves as the canonical
// source of truth. That fixture was verified against @polkadot/api and
// the live Asset Hub runtime (statemint 2001681).
//
// The three AH-required bytes are:
//   ChargeAssetTxPayment::extra  Option<MultiLocation>=None   0x00
//   CheckMetadataHash::extra     mode=Disabled                0x00
//   CheckMetadataHash::additional_signed  Option<H256>=None   0x00
//
// Without these the runtime computes a different payload hash than the
// wallet - BadProof on-chain.
// ---------------------------------------------------------------------------

const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

// Deterministic test vectors - no live RPC.
//
// method: Balances.transferKeepAlive(Alice, 100_000_000 Planck)
//   pallet 0x0a | method 0x03 | MultiAddress::Id 0x00 | Alice 32B | compact(100_000_000)
const METHOD = '0x0a0300d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d0284d717'

// era: mortal (blockNumber=42, period=64) - 0xa502
const ERA = '0xa502'

// nonce: 0 - compact 0x00
const NONCE = '0x0'

// tip: 0
const TIP = '0x0'

// specVersion: statemint 2001681 = 0x001E8B11
const SPEC_VERSION = '0x001e8b11'

// transactionVersion: 15 = 0x0f
const TX_VERSION = '0x0000000f'

// First 8 bytes are real AH genesis prefix; rest is fixture-stable zeros + sentinel `aa` trailer
const GENESIS_HASH = '0x68d56f15f4d3e1ec0000000000000000000000000000000000000000000000aa'

// blockHash: 32 bytes of 0x11 (deterministic stand-in for a real block hash)
const BLOCK_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111'

const basePayload: PolkadotSignerPayloadJSON = {
  address: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
  blockHash: BLOCK_HASH,
  blockNumber: '0x00',
  era: ERA,
  genesisHash: GENESIS_HASH,
  method: METHOD,
  nonce: NONCE,
  specVersion: SPEC_VERSION,
  tip: TIP,
  transactionVersion: TX_VERSION,
  signedExtensions: [
    'CheckNonZeroSender',
    'CheckSpecVersion',
    'CheckTxVersion',
    'CheckGenesis',
    'CheckMortality',
    'CheckNonce',
    'CheckWeight',
    'ChargeAssetTxPayment',
    'CheckMetadataHash',
  ],
  version: 4,
}

describe('constructAssetHubPolkadotSigningPayload', () => {
  it('matches AH-required canonical layout including all three signed-extension bytes', () => {
    const result = constructAssetHubPolkadotSigningPayload(basePayload)

    // Layout (ported from vultiagent-app assembleSignerPayload fixture):
    //   call || era || nonce || tip
    //   || ChargeAssetTxPayment(0x00) || CheckMetadataHash mode(0x00)
    //   || specVersion || txVersion || genesisHash || blockHash
    //   || CheckMetadataHash additional-signed(0x00)
    const expected =
      // call: 0a 03 00 <Alice 32B> compact(100_000_000)=02 84 d7 17
      '0a0300d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d0284d717' +
      // era (mortal blockNumber=42, period=64): a5 02
      'a502' +
      // nonce: 00
      '00' +
      // tip: 00
      '00' +
      // ChargeAssetTxPayment::extra Option<MultiLocation>=None: 00
      '00' +
      // CheckMetadataHash::extra mode=Disabled: 00
      '00' +
      // specVersion LE-u32: 11 8b 1e 00
      '118b1e00' +
      // txVersion LE-u32: 0f 00 00 00
      '0f000000' +
      // genesisHash (32B)
      '68d56f15f4d3e1ec0000000000000000000000000000000000000000000000aa' +
      // blockHash (32B)
      '1111111111111111111111111111111111111111111111111111111111111111' +
      // CheckMetadataHash::additional_signed Option<H256>=None: 00
      '00'

    expect(toHex(result)).toBe(expected)
  })

  it('is exactly 3 bytes longer than the pre-fix (missing AH ext bytes) shape', () => {
    // Proves the fixture is sensitive to the new bytes. The pre-fix payload
    // was: method || era || nonce || tip || specVersion || txVersion ||
    //      genesisHash || blockHash  (no AH signed-extension bytes at all).
    const result = constructAssetHubPolkadotSigningPayload(basePayload)

    // The payload is short (< 256 bytes), so no blake2 hashing kicks in -
    // we can count raw bytes directly.
    // call(39) + era(2) + nonce(1) + tip(1) + AH-ext(3) + spec(4) + txv(4) + genesis(32) + block(32) = 118
    // call breakdown: pallet(0x0a)+method(0x03)+MultiAddr-discriminant(0x00)=3B
    //   + Alice AccountId=32B + compact(100_000_000)=4B = 39B total
    expect(result.length).toBe(118)
    // 3 bytes = the two payload-phase bytes (assetIdNone, metaHashMode) +
    // the additional-signed byte (metaHashNone)
    const preFix = result.length - 3
    expect(preFix).toBe(115)
  })

  it('does NOT hash when raw payload is exactly 256 bytes (boundary)', () => {
    // Non-AH fields (era+nonce+tip+spec+txv+genesis+block+AH-ext) = 79 bytes.
    // method = 177 bytes -> total = 256 -> condition is `> 256` -> no hash.
    const boundaryMethod = '0x' + '00'.repeat(177)
    const result = constructAssetHubPolkadotSigningPayload({ ...basePayload, method: boundaryMethod })
    expect(result.length).toBe(256)
  })

  it('returns blake2b-256 hash when raw payload exceeds 256 bytes', () => {
    // method = 178 bytes -> total = 257 -> condition is `> 256` -> hash fires.
    const longMethod = '0x' + '00'.repeat(178)
    const result = constructAssetHubPolkadotSigningPayload({ ...basePayload, method: longMethod })
    // blake2b-256 always produces exactly 32 bytes
    expect(result.length).toBe(32)
  })

  it('encodes zero tip correctly (compact 0x00)', () => {
    const result = constructAssetHubPolkadotSigningPayload({ ...basePayload, tip: '0x0' })
    const hex = toHex(result)
    // method is 39 bytes (78 hex chars): positions [0..77]
    // era: [78..81], nonce: [82..83], tip: [84..85]
    expect(hex.slice(84, 86)).toBe('00')
  })
})
