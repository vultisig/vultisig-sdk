import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { nativeSwapChainIds } from '../NativeSwapChain'
import { toNativeSwapAsset } from './toNativeSwapAsset'

describe('toNativeSwapAsset', () => {
  it('THORChain: single-segment denom maps to THOR.<ticker>', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'ruji',
        ticker: 'RUJI',
      })
    ).toBe('THOR.RUJI')
  })

  it('MayaChain: single-segment denom maps to MAYA.<ticker>', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.MayaChain,
        id: 'cacao',
        ticker: 'CACAO',
      })
    ).toBe('MAYA.CACAO')
  })

  it('preserves full CHAIN.SYMBOL assets (THOR, thor, Maya, cross-chain)', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'THOR.RUJI',
        ticker: 'RUJI',
      })
    ).toBe('THOR.RUJI')
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'thor.ruji',
        ticker: 'RUJI',
      })
    ).toBe('thor.ruji')
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'maya.foo',
        ticker: 'FOO',
      })
    ).toBe('maya.foo')
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'BTC.BTC',
        ticker: 'BTC',
      })
    ).toBe('BTC.BTC')
  })

  it('normalizes x/… denom to last segment then THOR.<ticker>', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'x/ruji',
        ticker: 'RUJI',
      })
    ).toBe('THOR.RUJI')
  })

  it('x/… with dotted tail returns that asset string', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'x/thor.ruji',
        ticker: 'RUJI',
      })
    ).toBe('thor.ruji')
  })

  it('maps secured-asset hyphen denoms to cross-chain swap ids', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'btc-btc',
        ticker: 'BTC',
      })
    ).toBe('BTC.BTC')
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        ticker: 'USDC',
      })
    ).toBe('ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
  })

  it('derives secured-asset denom prefixes from nativeSwapChainIds', () => {
    for (const swapId of new Set(Object.values(nativeSwapChainIds))) {
      expect(
        toNativeSwapAsset({
          chain: Chain.THORChain,
          id: `${swapId.toLowerCase()}-asset`,
          ticker: 'ASSET',
        })
      ).toBe(`${swapId}.ASSET`)
    }
  })

  it('leaves unknown hyphen denoms unchanged', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'unknown-foo',
        ticker: 'FOO',
      })
    ).toBe('unknown-foo')
  })

  it('leaves complex x/… denoms unchanged', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'x/staking-x/ruji',
        ticker: 'sRUJI',
      })
    ).toBe('x/staking-x/ruji')
  })

  it('fee coin uses native swap chain id + ticker', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        ticker: 'RUNE',
      })
    ).toBe('THOR.RUNE')
  })

  it('non-native swap chain keeps ticker-id suffix form', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.Ethereum,
        id: '0xabc',
        ticker: 'USDC',
      })
    ).toBe('ETH.USDC-0xabc')
  })
})
