import { describe, expect, it } from 'vitest'

import { assertSafeDestination } from '@/utils/dangerousAddresses'

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
})
