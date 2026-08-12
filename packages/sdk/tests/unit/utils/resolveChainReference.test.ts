import { describe, expect, it } from 'vitest'

import { Chain, resolveChainIdReference, resolveChainReference } from '../../../src'

describe('resolveChainIdReference', () => {
  it('resolves exact Cosmos chain IDs and decimal EVM chain IDs only', () => {
    expect(resolveChainIdReference('1')).toBe(Chain.Ethereum)
    expect(resolveChainIdReference('phoenix-1')).toBe(Chain.Terra)
    expect(resolveChainIdReference('columbus-5')).toBe(Chain.TerraClassic)
  })

  it('fails closed on aliases and canonical names that are not strict chain IDs', () => {
    expect(resolveChainIdReference('ethereum')).toBeUndefined()
    expect(resolveChainIdReference('Ethereum')).toBeUndefined()
    expect(resolveChainIdReference('terra')).toBeUndefined()
    expect(resolveChainIdReference('Terra')).toBeUndefined()
  })
})

describe('resolveChainReference', () => {
  it('still accepts canonical names and aliases on the broader public helper', () => {
    expect(resolveChainReference('ethereum')).toBe(Chain.Ethereum)
    expect(resolveChainReference('Terra')).toBe(Chain.Terra)
    expect(resolveChainReference('1')).toBe(Chain.Ethereum)
    expect(resolveChainReference('phoenix-1')).toBe(Chain.Terra)
  })

  it.each([
    ['Terra Classic', Chain.TerraClassic],
    ['Bitcoin Cash', Chain.BitcoinCash],
    ['THOR Chain', Chain.THORChain],
    ['columbus-5', Chain.TerraClassic],
    [8453, Chain.Base],
    ['999', Chain.Hyperliquid],
    ['5000', Chain.Mantle],
    ['1329', Chain.Sei],
  ])('resolves %s to its canonical chain', (input, expected) => {
    expect(resolveChainReference(input)).toBe(expected)
  })

  it('narrows resolved values to the caller-provided canonical set', () => {
    expect(resolveChainReference('btc', [Chain.Bitcoin, Chain.Ethereum])).toBe(Chain.Bitcoin)
    expect(resolveChainReference('8453', [Chain.Bitcoin, Chain.Ethereum])).toBeUndefined()
  })

  it.each(['', 'unknown-chain', '0', 1.5, null, undefined])('returns undefined for unresolved input %s', input => {
    expect(resolveChainReference(input)).toBeUndefined()
  })
})
