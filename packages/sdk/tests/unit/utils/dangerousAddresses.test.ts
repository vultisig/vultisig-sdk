import { describe, expect, it } from 'vitest'

import * as sdk from '../../../src'
import {
  assertSafeDestination,
  SOLANA_DANGEROUS_ADDRESSES,
  UTXO_DANGEROUS_ADDRESSES,
  XRP_DANGEROUS_ADDRESSES,
} from '../../../src/utils/dangerousAddresses'

describe('assertSafeDestination', () => {
  it.each([
    '0x0000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000dead',
    '0xdead000000000000000042069420694206942069',
  ])('rejects known EVM burn address %s', burn => {
    expect(() => assertSafeDestination('Ethereum', burn)).toThrow(/Refusing to build transaction/)
  })

  it('rejects burn addresses regardless of casing (checksummed input)', () => {
    expect(() => assertSafeDestination('Base', '0xDeAD000000000000000042069420694206942069')).toThrow(
      /Refusing to build transaction/
    )
  })

  it('rejects EVM burn addresses regardless of the chain name passed', () => {
    // Shape-based detection: a 40-hex burn address is caught even on a chain the
    // util does not explicitly enumerate.
    expect(() => assertSafeDestination('SomeNewEvmChain', '0x000000000000000000000000000000000000dEaD')).toThrow(
      /Refusing to build transaction/
    )
  })

  it('allows a normal EVM recipient', () => {
    expect(() => assertSafeDestination('Ethereum', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).not.toThrow()
  })

  it('allows a non-EVM-shaped destination (no EVM table applies)', () => {
    expect(() => assertSafeDestination('Solana', 'SomeSolanaAddress1111')).not.toThrow()
  })

  it.each(Object.keys(SOLANA_DANGEROUS_ADDRESSES))('rejects known Solana dangerous address %s', burn => {
    expect(() => assertSafeDestination('Solana', burn)).toThrow(/Refusing to build transaction/)
  })

  it('does not apply Solana-only sentinel addresses to unrelated chains', () => {
    expect(() => assertSafeDestination('Bitcoin', '11111111111111111111111111111111')).not.toThrow()
  })

  // Reconciliation to mcp-ts parity + union (SDK #1160): SPL Token Program +
  // Wrapped SOL mint (Solana), Bitcoin null/eater (UTXO), XRP black-holes.
  it('rejects the SPL Token Program and Wrapped SOL mint on Solana', () => {
    expect(() => assertSafeDestination('Solana', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toThrow(
      /Refusing to build transaction/
    )
    expect(() => assertSafeDestination('Solana', 'So11111111111111111111111111111111111111112')).toThrow(
      /Refusing to build transaction/
    )
  })

  it('keeps the Solana Incinerator (only this SDK copy carried it pre-reconcile)', () => {
    expect(() => assertSafeDestination('Solana', '1nc1nerator11111111111111111111111111111111')).toThrow(
      /Refusing to build transaction/
    )
  })

  it.each(Object.keys(UTXO_DANGEROUS_ADDRESSES))('rejects Bitcoin burn address %s on UTXO chains', burn => {
    expect(() => assertSafeDestination('Bitcoin', burn)).toThrow(/Refusing to build transaction/)
    expect(() => assertSafeDestination('Litecoin', burn)).toThrow(/Refusing to build transaction/)
  })

  it.each(Object.keys(XRP_DANGEROUS_ADDRESSES))('rejects XRP black-hole address %s on Ripple', burn => {
    expect(() => assertSafeDestination('Ripple', burn)).toThrow(/Refusing to build transaction/)
  })

  it('keeps burn lists chain-family-scoped (no cross-family leakage)', () => {
    // A Bitcoin burn is not a Solana burn, and vice-versa.
    expect(() => assertSafeDestination('Solana', '1BitcoinEaterAddressDontSendf59kuE')).not.toThrow()
    expect(() => assertSafeDestination('Bitcoin', 'So11111111111111111111111111111111111111112')).not.toThrow()
    expect(() => assertSafeDestination('Ripple', '11111111111111111111111111111111')).not.toThrow()
  })

  it('is exported from the SDK public API', () => {
    expect(typeof sdk.assertSafeDestination).toBe('function')
    expect(typeof sdk.assertSafeEvmDestination).toBe('function')
    expect(typeof sdk.isEvmBurnAddress).toBe('function')
    expect(() => sdk.assertSafeDestination('Ripple', 'rrrrrrrrrrrrrrrrrrrrrhoLvTp')).toThrow(
      /Refusing to build transaction/
    )
  })
})
