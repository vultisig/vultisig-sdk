import { describe, expect, it } from 'vitest'

import { base58CheckTronDecode } from './tron'

// TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t is the USDT TRC20 contract address.
// Its 20-byte EVM representation is known from the Tron block explorer.
const VALID_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const VALID_ADDRESS_EVM_HEX = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c'

// A valid bs58check-encoded 21-byte payload whose first byte is 0x00 (BTC-style),
// not 0x41 (Tron mainnet). Checksum is valid but network prefix is wrong.
// Encoded form of: [0x00, 0xab * 20 bytes] + sha256d-checksum
const NON_TRON_PREFIX_ADDRESS = '1GeiCghwCEqjGS3hDZ1g1SM95h6FCMMzv7'

describe('base58CheckTronDecode', () => {
  it('decodes a valid tron address to the correct 20-byte evm hex', () => {
    const hex = base58CheckTronDecode(VALID_ADDRESS)
    expect(hex).toBe(VALID_ADDRESS_EVM_HEX)
    expect(hex).toHaveLength(40)
  })

  it('throws on a corrupted address (flipped checksum character)', () => {
    // Flip the last character to corrupt the Base58Check checksum.
    // Pre-fix (plain bs58) this silently decoded to a wrong 20-byte value
    // and returned balance 0 for a completely different account.
    // Post-fix (bs58check) this throws immediately.
    const lastChar = VALID_ADDRESS.slice(-1)
    const flippedChar = lastChar === 's' ? 't' : 's'
    const corrupted = VALID_ADDRESS.slice(0, -1) + flippedChar

    expect(() => base58CheckTronDecode(corrupted)).toThrow()
  })

  it('throws on a completely invalid string', () => {
    expect(() => base58CheckTronDecode('notanaddress')).toThrow()
  })

  it('throws when the decoded payload has a wrong network prefix (not 0x41)', () => {
    // Valid bs58check encoding but with a 0x00 prefix (BTC P2PKH style, not Tron).
    // Verifies that prefix validation runs after checksum validation.
    expect(() => base58CheckTronDecode(NON_TRON_PREFIX_ADDRESS)).toThrow(/invalid tron address prefix/)
  })
})
