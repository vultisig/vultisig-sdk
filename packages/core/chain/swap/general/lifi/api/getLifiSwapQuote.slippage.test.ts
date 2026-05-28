import { describe, expect, it } from 'vitest'

import { isStablePair, STABLE_TICKERS } from './getLifiSwapQuote'

const coin = (ticker: string) => ({ ticker })

describe('getLifiSwapQuote stable-pair slippage selection (issue #524)', () => {
  it('STABLE_TICKERS contains the canonical stable set', () => {
    for (const ticker of [
      'USDC',
      'USDT',
      'DAI',
      'BUSD',
      'TUSD',
      'FRAX',
      'USDP',
      'GUSD',
      'LUSD',
      'USDD',
      'FDUSD',
      'PYUSD',
    ]) {
      expect(STABLE_TICKERS.has(ticker)).toBe(true)
    }
  })

  it('isStablePair returns true for USDC/USDT', () => {
    expect(isStablePair(coin('USDC'), coin('USDT'))).toBe(true)
  })

  it('isStablePair returns true for DAI/USDC', () => {
    expect(isStablePair(coin('DAI'), coin('USDC'))).toBe(true)
  })

  it('isStablePair returns true for FRAX/USDT', () => {
    expect(isStablePair(coin('FRAX'), coin('USDT'))).toBe(true)
  })

  it('isStablePair returns false for ETH/USDC (volatile/stable mix)', () => {
    expect(isStablePair(coin('ETH'), coin('USDC'))).toBe(false)
  })

  it('isStablePair returns false for SOL/USDT (volatile/stable mix)', () => {
    expect(isStablePair(coin('SOL'), coin('USDT'))).toBe(false)
  })

  it('isStablePair returns false for ETH/BTC (volatile pair)', () => {
    expect(isStablePair(coin('ETH'), coin('BTC'))).toBe(false)
  })

  it('isStablePair handles case-insensitive tickers', () => {
    expect(isStablePair(coin('usdc'), coin('usdt'))).toBe(true)
  })

  it('isStablePair returns false when ticker is absent', () => {
    const noTicker = {}
    expect(isStablePair(noTicker, coin('USDT'))).toBe(false)
  })
})
