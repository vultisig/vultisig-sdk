import { ripemd160 } from '@noble/hashes/ripemd160'
import { sha256 } from '@noble/hashes/sha256'
import { describe, expect, it } from 'vitest'

import {
  computeAddressHash,
  computeAllClaimHashes,
  computeChainIdHash,
  computeClaimMessageHash,
  computeQbtcAddressHash,
} from './computeClaimHashes'

const hexToBytes = (hex: string) => Buffer.from(hex, 'hex')

const bytesToHex = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('hex')

// A well-known compressed public key for testing
const testCompressedPubkey = hexToBytes(
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
)

describe('computeAddressHash', () => {
  it('computes Hash160 for ECDSA circuit', () => {
    const result = computeAddressHash({
      compressedPubkey: testCompressedPubkey,
      circuit: 'ecdsa',
    })

    // Hash160 = RIPEMD160(SHA256(pubkey))
    const expected = ripemd160(sha256(testCompressedPubkey))
    expect(bytesToHex(result)).toBe(bytesToHex(expected))
    expect(result.length).toBe(20)
  })

  it('extracts x-only pubkey for Schnorr circuit', () => {
    const result = computeAddressHash({
      compressedPubkey: testCompressedPubkey,
      circuit: 'schnorr',
    })

    // x-only = last 32 bytes of 33-byte compressed key
    const expected = testCompressedPubkey.slice(1, 33)
    expect(bytesToHex(result)).toBe(bytesToHex(expected))
    expect(result.length).toBe(32)
  })
})

describe('computeQbtcAddressHash', () => {
  it('computes SHA256 of the qbtc address string', () => {
    const qbtcAddress = 'qbtc1abc123'
    const result = computeQbtcAddressHash(qbtcAddress)

    const expected = sha256(new TextEncoder().encode(qbtcAddress))
    expect(bytesToHex(result)).toBe(bytesToHex(expected))
    expect(result.length).toBe(32)
  })
})

describe('computeChainIdHash', () => {
  it('computes first 8 bytes of SHA256 of chain ID', () => {
    const result = computeChainIdHash('qbtc-1')

    const fullHash = sha256(new TextEncoder().encode('qbtc-1'))
    const expected = fullHash.slice(0, 8)
    expect(bytesToHex(result)).toBe(bytesToHex(expected))
    expect(result.length).toBe(8)
  })
})

describe('computeClaimMessageHash', () => {
  it('uses "ecdsa-hash160:" prefix for ECDSA circuit', () => {
    const addressHash = new Uint8Array(20).fill(0xaa)
    const qbtcAddressHash = new Uint8Array(32).fill(0xbb)
    const chainIdHash = new Uint8Array(8).fill(0xcc)

    const result = computeClaimMessageHash({
      addressHash,
      qbtcAddressHash,
      chainIdHash,
      circuit: 'ecdsa',
    })

    expect(result.length).toBe(32)

    // Verify by manually constructing the same input — must match
    // ClaimTagECDSAHash160 ("ecdsa-hash160:") on the chain side.
    const encoder = new TextEncoder()
    const input = new Uint8Array([
      ...encoder.encode('ecdsa-hash160:'),
      ...addressHash,
      ...qbtcAddressHash,
      ...chainIdHash,
      ...encoder.encode('qbtc-claim-v1'),
    ])
    expect(bytesToHex(result)).toBe(bytesToHex(sha256(input)))
  })

  it('rejects Schnorr circuit (not yet supported on-chain)', () => {
    const addressHash = new Uint8Array(32).fill(0xaa)
    const qbtcAddressHash = new Uint8Array(32).fill(0xbb)
    const chainIdHash = new Uint8Array(8).fill(0xcc)

    expect(() =>
      computeClaimMessageHash({
        addressHash,
        qbtcAddressHash,
        chainIdHash,
        circuit: 'schnorr',
      })
    ).toThrow(/Schnorr/)
  })
})

describe('computeAllClaimHashes', () => {
  it('computes all hashes for a P2WPKH address', () => {
    const result = computeAllClaimHashes({
      btcAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      compressedPubkey: testCompressedPubkey,
      qbtcAddress: 'qbtc1test',
      chainId: 'qbtc-1',
    })

    expect(result.circuit).toBe('ecdsa')
    expect(result.addressHash.length).toBe(20)
    expect(result.qbtcAddressHash.length).toBe(32)
    expect(result.messageHash.length).toBe(32)
  })

  it('rejects P2TR addresses until the chain defines a Schnorr tag', () => {
    expect(() =>
      computeAllClaimHashes({
        btcAddress:
          'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297',
        compressedPubkey: testCompressedPubkey,
        qbtcAddress: 'qbtc1test',
        chainId: 'qbtc-1',
      })
    ).toThrow(/Schnorr/)
  })
})
