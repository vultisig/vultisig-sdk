import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { describe, expect, it } from 'vitest'

import {
  getNativeDisplaySymbol,
  isNativeTickerForChain,
  nativeChainForTicker,
  unambiguousNativeChainForTicker,
} from '@/tools/token/nativeSymbols'

describe('native coin symbols', () => {
  it('displays TON and POL without changing canonical fee metadata', () => {
    expect(getNativeDisplaySymbol(Chain.Ton)).toBe('TON')
    expect(getNativeDisplaySymbol(Chain.Polygon)).toBe('POL')
    expect(chainFeeCoin[Chain.Ton].ticker).toBe('GRAM')
    expect(chainFeeCoin[Chain.Polygon].ticker).toBe('POL')

    for (const chain of Object.values(Chain)) {
      if (chain === Chain.Ton || chain === Chain.Polygon) continue
      expect(getNativeDisplaySymbol(chain)).toBe(chainFeeCoin[chain].ticker)
    }
  })

  it('matches only canonical native tickers and their chain-specific aliases', () => {
    expect(isNativeTickerForChain(Chain.Ton, ' ton ')).toBe(true)
    expect(isNativeTickerForChain(Chain.Ton, ' GrAm ')).toBe(true)
    expect(isNativeTickerForChain(Chain.Polygon, ' matic ')).toBe(true)
    expect(isNativeTickerForChain(Chain.Polygon, ' pol ')).toBe(true)
    expect(isNativeTickerForChain(Chain.Bitcoin, ' bTc ')).toBe(true)
    expect(isNativeTickerForChain(Chain.Ethereum, 'ETH')).toBe(true)
    expect(isNativeTickerForChain(Chain.Ton, 'MATIC')).toBe(false)
    expect(isNativeTickerForChain(Chain.Polygon, 'TON')).toBe(false)
    expect(isNativeTickerForChain(Chain.Ethereum, 'WETH')).toBe(false)
    expect(isNativeTickerForChain(Chain.Ethereum, ' ')).toBe(false)
  })

  it('resolves only unique native chains', () => {
    for (const lookup of [nativeChainForTicker, unambiguousNativeChainForTicker]) {
      expect(lookup('ton')).toBe(Chain.Ton)
      expect(lookup(' GRAM ')).toBe(Chain.Ton)
      expect(lookup('Matic')).toBe(Chain.Polygon)
      expect(lookup('POL')).toBe(Chain.Polygon)
      expect(lookup(' btc ')).toBe(Chain.Bitcoin)
      expect(lookup('ETH')).toBeUndefined()
      expect(lookup('WETH')).toBeUndefined()
      expect(lookup('UNKNOWN')).toBeUndefined()
      expect(lookup('  ')).toBeUndefined()
    }
  })
})
