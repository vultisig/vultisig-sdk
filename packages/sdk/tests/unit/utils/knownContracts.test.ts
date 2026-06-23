import { describe, expect, it } from 'vitest'

import {
  canonicalEvmContracts,
  canonicalSolanaAddresses,
  canonicalTronContracts,
  isCanonicalEvmContract,
  isCanonicalEvmContractEllipsized,
  isCanonicalSolanaAddress,
  isCanonicalSolanaAddressEllipsized,
  isCanonicalTronContract,
  isEvmAddressFormat,
  isKnownContract,
  knownContracts,
} from '../../../src/utils/knownContracts'

// Well-known public constants used as fixtures (all public infrastructure).
const USDC_ETH = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const LIFI_DIAMOND = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'
const ONEINCH_V5 = '0x1111111254eeb25477b68fb85ed929f73a960582'
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const USDT_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

describe('knownContracts — EVM', () => {
  it('validates EVM address format', () => {
    expect(isEvmAddressFormat(USDC_ETH)).toBe(true)
    expect(isEvmAddressFormat('0x1234')).toBe(false) // too short
    expect(isEvmAddressFormat('a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(false) // no 0x
    expect(isEvmAddressFormat(`${USDC_ETH}00`)).toBe(false) // too long
    expect(isEvmAddressFormat('0xZZb86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(false) // non-hex
  })

  it('matches a canonical token + router', () => {
    expect(isCanonicalEvmContract(USDC_ETH)).toBe(true)
    expect(isCanonicalEvmContract(LIFI_DIAMOND)).toBe(true)
    expect(isCanonicalEvmContract(ONEINCH_V5)).toBe(true)
  })

  it('is case-insensitive (checksum variant collapses to canonical)', () => {
    const checksummed = '0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48'
    expect(checksummed).not.toBe(USDC_ETH) // genuinely mixed case
    expect(isCanonicalEvmContract(checksummed)).toBe(true)
  })

  it('rejects an unknown / malformed EVM address', () => {
    expect(isCanonicalEvmContract('0x000000000000000000000000000000000000dead')).toBe(false)
    expect(isCanonicalEvmContract('not-an-address')).toBe(false)
    expect(isCanonicalEvmContract('')).toBe(false)
  })

  it('matches an ellipsized EVM rendering by prefix + suffix', () => {
    expect(isCanonicalEvmContractEllipsized('0xa0b8…eb48')).toBe(true)
    expect(isCanonicalEvmContractEllipsized('0xA0b8...eB48')).toBe(true) // case-insensitive + ascii ellipsis
    expect(isCanonicalEvmContractEllipsized('0xdead…beef')).toBe(false)
    expect(isCanonicalEvmContractEllipsized(USDC_ETH)).toBe(false) // full form is not ellipsized
  })

  // Fail-closed guard: an unbounded head/tail would let a 1-2 char fragment
  // ("0x…48", "0xa…48") collapse onto a canonical entry by prefix+suffix and
  // wrongly report a known contract, widening the bypass below what the Go
  // `reTrunc` {3,8} bound enforces. These must stay false.
  it('rejects too-short ellipsized fragments (Go {3,8} head/tail bound)', () => {
    expect(isCanonicalEvmContractEllipsized('0x…48')).toBe(false) // head 2 chars
    expect(isCanonicalEvmContractEllipsized('0x…8')).toBe(false) // head 2 + tail 1
    expect(isCanonicalEvmContractEllipsized('0xA0b8…48')).toBe(false) // tail 2 chars
    expect(isCanonicalEvmContractEllipsized('0xA0b8...8')).toBe(false) // tail 1, ascii
    expect(isKnownContract('0x…48')).toBe(false)
    expect(isKnownContract('0xa…48')).toBe(false)
  })

  // …and a too-LONG head/tail (>8) must also miss, matching the Go upper bound.
  it('rejects over-long ellipsized fragments (>8 head/tail)', () => {
    expect(isCanonicalEvmContractEllipsized('0xa0b86991c…eb48')).toBe(false) // head 11 chars
    expect(isCanonicalEvmContractEllipsized('0xa0b8…ce3606eb48')).toBe(false) // tail 12 chars
  })
})

describe('knownContracts — Solana', () => {
  it('matches canonical program ID + SPL mint (case-sensitive)', () => {
    expect(isCanonicalSolanaAddress(USDC_SOL)).toBe(true)
    expect(isCanonicalSolanaAddress(JUPITER_V6)).toBe(true)
    expect(isCanonicalSolanaAddress(USDC_SOL.toLowerCase())).toBe(false) // base58 is case-sensitive
    expect(isCanonicalSolanaAddress('SomeRandomPubkey1111111111111111111111111111')).toBe(false)
  })

  it('matches an ellipsized Solana rendering', () => {
    expect(isCanonicalSolanaAddressEllipsized('EPjFWd...Dt1v')).toBe(true)
    expect(isCanonicalSolanaAddressEllipsized('Zzzzzz...Dt1v')).toBe(false)
  })

  // Same fail-closed guard as EVM: a 1-2 char head/tail must not collapse onto
  // a canonical mint by prefix+suffix (matches Go reTrunc {3,8}).
  it('rejects too-short ellipsized Solana fragments', () => {
    expect(isCanonicalSolanaAddressEllipsized('E…v')).toBe(false) // head + tail 1 char
    expect(isCanonicalSolanaAddressEllipsized('EP…1v')).toBe(false) // head 2 chars
    expect(isKnownContract('E…v')).toBe(false)
  })
})

describe('knownContracts — Tron', () => {
  it('matches canonical TRC-20 + SUNSwap contracts (case-sensitive)', () => {
    expect(isCanonicalTronContract(USDT_TRON)).toBe(true)
    expect(isCanonicalTronContract('TThJt8zaJzJMhCEScH7zWKnp5buVZqys9x')).toBe(true)
    expect(isCanonicalTronContract('TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')).toBe(false)
  })
})

describe('knownContracts — chain-agnostic isKnownContract', () => {
  it('is true for any registered contract across chains', () => {
    expect(isKnownContract(USDC_ETH)).toBe(true)
    expect(isKnownContract('0xA0b8…eB48')).toBe(true) // ellipsized EVM
    expect(isKnownContract(USDC_SOL)).toBe(true)
    expect(isKnownContract('EPjFWd...Dt1v')).toBe(true) // ellipsized Solana
    expect(isKnownContract(USDT_TRON)).toBe(true)
  })

  it('is false for an unknown address', () => {
    expect(isKnownContract('0x000000000000000000000000000000000000dead')).toBe(false)
    expect(isKnownContract('')).toBe(false)
  })
})

describe('knownContracts — registry integrity + facade', () => {
  it('stores EVM entries lowercase + well-formed', () => {
    for (const addr of canonicalEvmContracts) {
      expect(addr).toBe(addr.toLowerCase())
      expect(isEvmAddressFormat(addr)).toBe(true)
    }
  })

  it('has non-empty Solana + Tron sets', () => {
    expect(canonicalSolanaAddresses.size).toBeGreaterThan(0)
    expect(canonicalTronContracts.size).toBeGreaterThan(0)
  })

  it('exposes the namespaced facade with the same behavior', () => {
    expect(knownContracts.isKnownContract(USDC_ETH)).toBe(true)
    expect(knownContracts.canonicalEvmContracts.has(USDC_ETH)).toBe(true)
    expect(knownContracts.isCanonicalSolanaAddress(JUPITER_V6)).toBe(true)
  })
})
