import { describe, expect, it } from 'vitest'

import { Chain } from '../Chain'
import { isValidTxHash } from './isValidTxHash'

const evmHash = '0x' + 'a'.repeat(64)
const hex64 = 'a'.repeat(64)

describe('isValidTxHash', () => {
  it('accepts a well-formed 0x-prefixed 64-hex EVM hash', () => {
    expect(isValidTxHash(Chain.Ethereum, evmHash)).toBe(true)
    expect(isValidTxHash(Chain.Arbitrum, evmHash)).toBe(true)
  })

  it('rejects obvious garbage on EVM', () => {
    expect(isValidTxHash(Chain.Ethereum, 'nothash')).toBe(false)
    expect(isValidTxHash(Chain.Ethereum, '')).toBe(false)
    expect(isValidTxHash(Chain.Ethereum, '0x1234')).toBe(false)
    // Missing 0x prefix.
    expect(isValidTxHash(Chain.Ethereum, hex64)).toBe(false)
    // Wrong length (63 hex).
    expect(isValidTxHash(Chain.Ethereum, '0x' + 'a'.repeat(63))).toBe(false)
    // Non-hex char.
    expect(isValidTxHash(Chain.Ethereum, '0x' + 'g'.repeat(64))).toBe(false)
  })

  it('accepts bare 64-hex for UTXO / cosmos / ripple / tron / cardano', () => {
    for (const chain of [Chain.Bitcoin, Chain.Cosmos, Chain.Ripple, Chain.Tron, Chain.Cardano]) {
      expect(isValidTxHash(chain, hex64)).toBe(true)
      expect(isValidTxHash(chain, hex64.toUpperCase())).toBe(true)
      expect(isValidTxHash(chain, evmHash)).toBe(false) // 0x-prefixed is wrong here
      expect(isValidTxHash(chain, 'nothash')).toBe(false)
    }
  })

  it('rejects short garbage for base58 chains but accepts realistic lengths', () => {
    expect(isValidTxHash(Chain.Solana, 'nothash')).toBe(false)
    expect(isValidTxHash(Chain.Sui, 'nothash')).toBe(false)
    // A 44-char base58 digest for Sui, an 88-char base58 signature for Solana.
    expect(isValidTxHash(Chain.Sui, 'A'.repeat(44))).toBe(true)
    expect(isValidTxHash(Chain.Solana, 'A'.repeat(88))).toBe(true)
  })

  it('requires the 0x prefix for polkadot / bittensor (substrate hashes)', () => {
    for (const chain of [Chain.Polkadot, Chain.Bittensor]) {
      expect(isValidTxHash(chain, evmHash)).toBe(true)
      expect(isValidTxHash(chain, hex64)).toBe(false) // missing 0x
      expect(isValidTxHash(chain, 'nothash')).toBe(false)
    }
  })

  it('accepts either bare-hex or base64 for ton, and 64-hex for qbtc', () => {
    // TON is the only dual-pattern validator.
    expect(isValidTxHash(Chain.Ton, hex64)).toBe(true)
    expect(isValidTxHash(Chain.Ton, `${'A'.repeat(43)}=`)).toBe(true) // base64-ish, 44 chars
    expect(isValidTxHash(Chain.Ton, 'nothash')).toBe(false)
    expect(isValidTxHash(Chain.QBTC, hex64)).toBe(true)
    expect(isValidTxHash(Chain.QBTC, 'nothash')).toBe(false)
  })

  it('trims surrounding whitespace before validating', () => {
    expect(isValidTxHash(Chain.Ethereum, `  ${evmHash}\n`)).toBe(true)
  })
})
