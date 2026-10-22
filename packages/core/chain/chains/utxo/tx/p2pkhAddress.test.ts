import { Chain } from '@vultisig/core-chain/Chain'
import { Buffer } from 'buffer'
import { describe, expect, it } from 'vitest'

import {
  buildP2pkhScript,
  encodeP2pkhAddress,
  getP2pkhKeyHashForAddress,
  getP2pkhScriptForAddress,
  getP2pkhScriptKeyHash,
  getPublicKeyHash160,
} from './p2pkhAddress'

// The CashAddr specification's own example pair, which SwapKit's BCH fixture also uses.
const bchLegacy = '1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu'
const bchCashAddr = 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a'
const bchKeyHash = '76a04053bda0a88bda5177b86a15c3b29f559873'

// Source addresses of live SwapKit routes captured on iOS.
const dogeAddress = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L'
const dogeKeyHash = '830a7420e63d76244ff7cbd1c248e94c14463259'
const dashAddress = 'XdAUmwtig27HBG6WfYyHAzP8n6XC9jESEw'
const dashKeyHash = '1b2a522cc8d42b0be7ceb8db711416794d50c846'
const zcashAddress = 't1bnxtY7aLCjWx9Ru1YcGwRWch3eEWUFK7u'
const zcashKeyHash = 'c4919dca916dc416c06d51cb1940a7ba268c475d'

describe('getP2pkhKeyHashForAddress', () => {
  it.each([
    [Chain.Dogecoin, dogeAddress, dogeKeyHash],
    [Chain.Dash, dashAddress, dashKeyHash],
    [Chain.Zcash, zcashAddress, zcashKeyHash],
    [Chain.BitcoinCash, bchLegacy, bchKeyHash],
    [Chain.BitcoinCash, bchCashAddr, bchKeyHash],
    [Chain.BitcoinCash, `bitcoincash:${bchCashAddr}`, bchKeyHash],
    [Chain.BitcoinCash, `BITCOINCASH:${bchCashAddr.toUpperCase()}`, bchKeyHash],
  ] as const)('decodes the %s address %s', (chain, address, keyHash) => {
    expect(getP2pkhKeyHashForAddress({ chain, address }).toString('hex')).toBe(keyHash)
    expect(getP2pkhScriptForAddress({ chain, address }).toString('hex')).toBe(`76a914${keyHash}88ac`)
  })

  it.each([
    ['a Bitcoin Cash address on Dogecoin', Chain.Dogecoin, bchLegacy],
    ['a Dogecoin address on Zcash', Chain.Zcash, dogeAddress],
    ['a corrupted base58 checksum', Chain.Dogecoin, `${dogeAddress.slice(0, -1)}M`],
    ['a corrupted CashAddr checksum', Chain.BitcoinCash, `${bchCashAddr.slice(0, -1)}q`],
    ['a mixed-case CashAddr', Chain.BitcoinCash, bchCashAddr.slice(0, 10) + bchCashAddr.slice(10).toUpperCase()],
    ['a CashAddr under another network prefix', Chain.BitcoinCash, `bchtest:${bchCashAddr}`],
    ['a segwit address', Chain.BitcoinCash, 'bc1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg'],
    ['an empty string', Chain.Dash, ''],
  ] as const)('rejects %s', (_, chain, address) => {
    expect(() => getP2pkhKeyHashForAddress({ chain, address })).toThrow(`Invalid ${chain} P2PKH address`)
  })
})

describe('encodeP2pkhAddress', () => {
  it.each([
    [Chain.Dogecoin, dogeKeyHash, dogeAddress],
    [Chain.Dash, dashKeyHash, dashAddress],
    [Chain.Zcash, zcashKeyHash, zcashAddress],
    // Bare CashAddr is the spelling the vault stores for its own address.
    [Chain.BitcoinCash, bchKeyHash, bchCashAddr],
  ] as const)('encodes a %s key hash as the address the vault would store', (chain, keyHash, address) => {
    expect(encodeP2pkhAddress({ chain, keyHash: Buffer.from(keyHash, 'hex') })).toBe(address)
  })
})

describe('P2PKH scripts', () => {
  it('extracts the key hash of a P2PKH script and nothing else', () => {
    expect(getP2pkhScriptKeyHash(Buffer.from(`76a914${bchKeyHash}88ac`, 'hex'))?.toString('hex')).toBe(bchKeyHash)
    expect(getP2pkhScriptKeyHash(Buffer.from(`0014${bchKeyHash}`, 'hex'))).toBeUndefined()
    expect(getP2pkhScriptKeyHash(Buffer.from(`76a914${bchKeyHash}88ac00`, 'hex'))).toBeUndefined()
    expect(buildP2pkhScript(Buffer.from(bchKeyHash, 'hex')).toString('hex')).toBe(`76a914${bchKeyHash}88ac`)
  })

  it('hashes a compressed public key the way its P2PKH outputs are locked', () => {
    // The secp256k1 generator point as a compressed key: the standard test vector.
    const publicKey = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
    expect(getPublicKeyHash160(publicKey).toString('hex')).toBe('751e76e8199196d454941c45d1b3a323f1433bd6')
  })
})
