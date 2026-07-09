import { describe, expect, it } from 'vitest'

import { Chain } from '../../Chain'
import type { Coin } from '../Coin'
import { findByTicker } from './findByTicker'

const coin = (chain: Chain, ticker: string): Coin => ({ chain, ticker }) as Coin

describe('findByTicker (SDK2-02 — no silent cross-chain first-match)', () => {
  it('returns the unique match when the ticker is on a single chain', () => {
    const coins = [coin(Chain.Ethereum, 'ETH'), coin(Chain.Ethereum, 'USDC')]
    expect(findByTicker({ coins, ticker: 'USDC' })?.chain).toBe(Chain.Ethereum)
  })

  it('returns null when the ticker is absent', () => {
    expect(findByTicker({ coins: [coin(Chain.Ethereum, 'ETH')], ticker: 'USDC' })).toBeNull()
  })

  it('THROWS on a ticker ambiguous across chains instead of silently picking the array-first one', () => {
    const coins = [coin(Chain.Ethereum, 'USDC'), coin(Chain.Polygon, 'USDC'), coin(Chain.Base, 'USDC')]
    expect(() => findByTicker({ coins, ticker: 'USDC' })).toThrow(/ambiguous across 3 chains/)
  })
})
