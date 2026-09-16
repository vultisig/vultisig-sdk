import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { resolveChainIdReference, resolveChainReference } from '../../../src/utils/resolveChainReference'

describe('resolveChainIdReference', () => {
  it.each([
    ['1', Chain.Ethereum],
    ['8453', Chain.Base],
    ['phoenix-1', Chain.Terra],
    ['columbus-5', Chain.TerraClassic],
  ])('resolves exact chain ID %s', (input, expected) => {
    expect(resolveChainIdReference(input)).toBe(expected)
  })

  it.each([
    'Ethereum',
    'eth',
    'Terra Classic',
    ' 8453 ',
    ' phoenix-1 ',
    'PHOENIX-1',
    '0x2105',
    '08453',
    '+8453',
    '8453.0',
    '8.453e3',
    '9007199254740993',
    '-1',
    '0',
    '',
    'unknown-chain',
    '123456789',
  ])('rejects noncanonical or unknown chain ID %s', input => {
    expect(resolveChainIdReference(input)).toBeUndefined()
  })
})

describe('resolveChainReference', () => {
  it.each([
    ['Ethereum', Chain.Ethereum],
    ['eth', Chain.Ethereum],
    [' 8453 ', Chain.Base],
    [' phoenix-1 ', Chain.Terra],
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
