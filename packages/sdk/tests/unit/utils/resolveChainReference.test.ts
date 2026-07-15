import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { resolveChainReference } from '../../../src/utils/resolveChainReference'

describe('resolveChainReference', () => {
  it.each([
    ['Terra Classic', Chain.TerraClassic],
    ['Bitcoin Cash', Chain.BitcoinCash],
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
