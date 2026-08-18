import { describe, expect, it } from 'vitest'

import { getChainDecimals, getChainTicker } from './formatting'

// sdk#1648: VaultSend/VaultSwap used to carry local ticker/decimals maps that
// had already drifted from the SDK's canonical chainFeeCoin registry (they
// omitted Ton, Noble, Tron, CronosChain, Dydx, Kujira, Mantle, Hyperliquid,
// and Sei entirely). These chains are the ones the issue names explicitly.
describe('getChainTicker / getChainDecimals', () => {
  it.each([
    ['Ton', 'GRAM', 9],
    ['Noble', 'USDC', 6],
    ['Tron', 'TRX', 6],
    ['Polygon', 'POL', 18],
    ['Mantle', 'MNT', 18],
    ['Hyperliquid', 'HYPE', 18],
    ['Sei', 'SEI', 18],
  ])('resolves %s from the canonical chainFeeCoin registry, not a local copy', (chain, ticker, decimals) => {
    expect(getChainTicker(chain)).toBe(ticker)
    expect(getChainDecimals(chain)).toBe(decimals)
  })

  it('falls back to the chain name / 18 decimals for an unrecognized chain', () => {
    expect(getChainTicker('NotARealChain')).toBe('NotARealChain')
    expect(getChainDecimals('NotARealChain')).toBe(18)
  })
})
