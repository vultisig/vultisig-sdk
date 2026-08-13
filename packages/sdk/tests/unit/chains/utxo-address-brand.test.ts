import { describe, expect, it } from 'vitest'

import {
  assertUtxoAddressBrand,
  isUtxoAddressBrandValid,
  type UtxoChainName,
} from '../../../src/chains/utxo/addressBrand'
import { decodeAddressToPubKeyHash } from '../../../src/chains/utxo/tx'
import { isAddressValidForChain } from '../../../src/utils/addressFormat'

const GOLDEN_ADDRESSES: Record<UtxoChainName, readonly string[]> = {
  Bitcoin: [
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    '16L5yRNPTuciSgXGHqYwn9N6NeoKqopAu',
    '31nM1WuowNDzocNxPPW9NQWJEtwWpjfcLj',
  ],
  Litecoin: [
    'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9',
    'LKKHMBjCU89fyFNgSRprDoD8Jb25N8uWvd',
    'M7zVKQKmtV5Rc7erVGVVC3khZbXxsS5HEX',
  ],
  Dogecoin: ['D5ERdEN1gsouFSs7zsq7VYJxyWP6dP28H1', '9rXbkMyi1S6thykRoXAZcY8fwUKYsy6cXE'],
  Dash: ['XanAvE5GMB8CsPH78B9moJq9viEVKvCS4f', '7SVyqiBykMKdoNuuf1AehnVxASmtdfqsFF'],
  'Bitcoin-Cash': [
    'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
    'bitcoincash:ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq',
  ],
  Zcash: ['t1Hxw6JqWMnhDK5jRCieg5bFHM2qt7UtQvu', 't3Jex1rKwuh1bQFRrKpKGWDcDVZ8bbQuNrB'],
}

const CHAINS = Object.keys(GOLDEN_ADDRESSES) as UtxoChainName[]
const ZCASH_SAPLING_ADDRESS = 'zs1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7ruszzg3rysjjvfeg9y4zkvtfdeq'
const ZCASH_SAPLING_BECH32M_VARIANT = 'zs1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5z5tpwxqergd3c8g7ruszzg3rysjjvfeg9y4zkehepuz'
const INVALID_BITCOIN_SEGWIT_ADDRESSES = [
  'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd',
  'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh',
  'BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R',
  'bc1pw5dgrnzv',
  'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v8n0nx0muaewav253zgeav',
  'BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P',
  'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf',
]

describe('UTXO address brand validation', () => {
  it.each(CHAINS)('accepts golden %s addresses', chain => {
    for (const address of GOLDEN_ADDRESSES[chain]) {
      expect(isUtxoAddressBrandValid(address, chain)).toBe(true)
      expect(() => assertUtxoAddressBrand(address, chain)).not.toThrow()
    }
  })

  it.each(CHAINS)('rejects every other UTXO chain brand as %s', expectedChain => {
    for (const actualChain of CHAINS) {
      if (actualChain === expectedChain) continue
      expect(isUtxoAddressBrandValid(GOLDEN_ADDRESSES[actualChain][0]!, expectedChain)).toBe(false)
    }
  })

  it('rejects malformed and checksum-invalid addresses', () => {
    expect(isUtxoAddressBrandValid('', 'Bitcoin')).toBe(false)
    expect(isUtxoAddressBrandValid('bc1not-a-valid-address', 'Bitcoin')).toBe(false)
    expect(isUtxoAddressBrandValid('bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6x', 'Bitcoin-Cash')).toBe(
      false
    )
  })

  it('accepts uniform uppercase encodings and rejects mixed case', () => {
    const bitcoin = GOLDEN_ADDRESSES.Bitcoin[0]!
    const bitcoinCash = GOLDEN_ADDRESSES['Bitcoin-Cash'][0]!

    expect(isUtxoAddressBrandValid(bitcoin.toUpperCase(), 'Bitcoin')).toBe(true)
    expect(isUtxoAddressBrandValid(bitcoinCash.toUpperCase(), 'Bitcoin-Cash')).toBe(true)
    expect(isUtxoAddressBrandValid(ZCASH_SAPLING_ADDRESS.toUpperCase(), 'Zcash')).toBe(true)
    expect(isUtxoAddressBrandValid(`${bitcoin.slice(0, -1)}T`, 'Bitcoin')).toBe(false)
    expect(isUtxoAddressBrandValid(`${bitcoinCash.slice(0, -1)}A`, 'Bitcoin-Cash')).toBe(false)
    expect(decodeAddressToPubKeyHash(bitcoin.toUpperCase(), 'Bitcoin')).toEqual(
      decodeAddressToPubKeyHash(bitcoin, 'Bitcoin')
    )
    expect(() => decodeAddressToPubKeyHash(ZCASH_SAPLING_ADDRESS.toUpperCase(), 'Zcash')).toThrow(
      'Zcash shielded outputs are not supported by this SDK build'
    )
  })

  it.each(INVALID_BITCOIN_SEGWIT_ADDRESSES)('rejects the invalid BIP-350 SegWit vector %s', address => {
    expect(isUtxoAddressBrandValid(address, 'Bitcoin')).toBe(false)
  })

  it('recognizes a checksummed Zcash Sapling address without treating it as a signable transparent output', () => {
    expect(isUtxoAddressBrandValid(ZCASH_SAPLING_ADDRESS, 'Zcash')).toBe(true)
    expect(isUtxoAddressBrandValid(ZCASH_SAPLING_ADDRESS, 'Bitcoin')).toBe(false)
    expect(isUtxoAddressBrandValid(`${ZCASH_SAPLING_ADDRESS.slice(0, -1)}x`, 'Zcash')).toBe(false)
    expect(isUtxoAddressBrandValid(ZCASH_SAPLING_BECH32M_VARIANT, 'Zcash')).toBe(false)
    expect(isAddressValidForChain(ZCASH_SAPLING_ADDRESS, 'Zcash')).toBe(true)
    expect(() => decodeAddressToPubKeyHash(ZCASH_SAPLING_ADDRESS, 'Zcash')).toThrow(
      'Zcash shielded outputs are not supported by this SDK build'
    )
  })

  it('guards the UTXO decoder before a same-length wrong-chain payload can be re-encoded', () => {
    const dogecoinAddress = GOLDEN_ADDRESSES.Dogecoin[0]!
    expect(() => decodeAddressToPubKeyHash(dogecoinAddress, 'Bitcoin')).toThrow(
      'UTXO address brand mismatch: expected a valid Bitcoin address'
    )
  })

  it('backs the generic per-chain address validator with the same canonical policy', () => {
    const dogecoinAddress = GOLDEN_ADDRESSES.Dogecoin[0]!
    expect(isAddressValidForChain(dogecoinAddress, 'Dogecoin')).toBe(true)
    expect(isAddressValidForChain(dogecoinAddress, 'Bitcoin')).toBe(false)
  })
})
