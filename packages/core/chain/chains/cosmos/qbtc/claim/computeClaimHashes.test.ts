import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'

import { computeClaimMessageHash, getBitcoinSignedMessageDigest, getClaimMessageText } from './computeClaimHashes'

const bytesToHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

/** SHA256d(0x18 || "Bitcoin Signed Message:\n" || compactSize(len) || text), built by hand. */
const referenceDigest = (text: string) => {
  const textBytes = Buffer.from(text, 'utf8')
  const length =
    textBytes.length < 0xfd
      ? Buffer.from([textBytes.length])
      : Buffer.from([0xfd, textBytes.length & 0xff, textBytes.length >> 8])
  return sha256(
    sha256(Buffer.concat([Buffer.from([0x18]), Buffer.from('Bitcoin Signed Message:\n'), length, textBytes]))
  )
}

const claim = {
  chainId: 'qbtc-1',
  bitcoinAddress: 'bc1qatknmeca5p0fy5decdj5704hf7prt47e0e7e9n',
  qbtcAddress: 'qbtc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpz7s0q',
}

describe('getClaimMessageText', () => {
  it('joins the version, chain ID, Bitcoin address and destination with "|"', () => {
    expect(getClaimMessageText({ chainId: 'qbtc-1', bitcoinAddress: 'bc1qexample', qbtcAddress: 'qbtc1dest' })).toBe(
      'qbtc-claim-v1|qbtc-1|bc1qexample|qbtc1dest'
    )
  })
})

describe('getBitcoinSignedMessageDigest', () => {
  // Bitcoin Core test/functional/rpc_signmessagewithprivkey.py, also pinned by
  // btcq-org/qbtc x/qbtc/zk/testdata/bip137_vectors.json. The public key is
  // that of WIF cUeKHd5orzT3mz8P9pxyREHfsWtVfgsfDjiZZBcjUBAaGk1BTj7N.
  it("recovers Bitcoin Core's signmessagewithprivkey signer", () => {
    const signature = Buffer.from(
      'INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=',
      'base64'
    )
    const recoveryId = (signature[0] - 27) & 3
    const recovered = secp256k1.recoverPublicKey(
      Uint8Array.from([recoveryId, ...signature.subarray(1)]),
      getBitcoinSignedMessageDigest('This is just a test message'),
      { prehash: false }
    )

    expect(bytesToHex(recovered)).toBe('03c150061989643d77162902b725409087959f15914649d4f06b6cc3f8c87bb238')
  })

  it.each(['', 'x'.repeat(252), 'x'.repeat(253), 'x'.repeat(300), 'Virès is Numéris'])(
    'matches the hand-built BIP-137 preimage for %j',
    text => {
      expect(bytesToHex(getBitcoinSignedMessageDigest(text))).toBe(bytesToHex(referenceDigest(text)))
    }
  )
})

describe('computeClaimMessageHash', () => {
  it('is the BIP-137 digest of the claim text', () => {
    expect(bytesToHex(computeClaimMessageHash(claim))).toBe(
      bytesToHex(referenceDigest(`qbtc-claim-v1|${claim.chainId}|${claim.bitcoinAddress}|${claim.qbtcAddress}`))
    )
  })

  it('accepts a P2PKH address', () => {
    expect(computeClaimMessageHash({ ...claim, bitcoinAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2' })).toHaveLength(32)
  })

  it.each([
    ['the chain ID', { chainId: 'other-chain-1' }],
    ['the Bitcoin address', { bitcoinAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2' }],
    ['the destination', { qbtcAddress: 'qbtc1attacker' }],
  ])('binds %s', (_, change) => {
    expect(bytesToHex(computeClaimMessageHash({ ...claim, ...change }))).not.toBe(
      bytesToHex(computeClaimMessageHash(claim))
    )
  })

  it('binds the version token', () => {
    expect(bytesToHex(computeClaimMessageHash(claim))).not.toBe(
      bytesToHex(getBitcoinSignedMessageDigest([claim.chainId, claim.bitcoinAddress, claim.qbtcAddress].join('|')))
    )
  })

  it.each([
    ['P2SH-P2WPKH', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
    ['P2WSH', 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'],
    ['P2TR', 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'],
  ])('rejects a %s address', (_, bitcoinAddress) => {
    expect(() => computeClaimMessageHash({ ...claim, bitcoinAddress })).toThrow('P2PKH and P2WPKH addresses only')
  })
})
