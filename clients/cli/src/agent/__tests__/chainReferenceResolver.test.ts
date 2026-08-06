import { Chain } from '@vultisig/sdk'
import { describe, expect, it } from 'vitest'

import { resolveChain, resolveChainId } from '../executor'

describe('CLI chain reference resolution', () => {
  it.each([
    ['Terra Classic', Chain.TerraClassic],
    ['Bitcoin Cash', Chain.BitcoinCash],
    ['columbus-5', Chain.TerraClassic],
  ])('resolves name reference %s through the SDK', (input, expected) => {
    expect(resolveChain(input)).toBe(expected)
  })

  it.each([
    [8453, Chain.Base],
    ['999', Chain.Hyperliquid],
    ['5000', Chain.Mantle],
    ['1329', Chain.Sei],
  ])('resolves ID reference %s through the SDK', (input, expected) => {
    expect(resolveChainId(input)).toBe(expected)
  })

  it('preserves null for unresolved names and IDs', () => {
    expect(resolveChain('not-a-chain')).toBeNull()
    expect(resolveChainId('not-an-id')).toBeNull()
  })
})
