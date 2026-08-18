import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { describe, expect, it } from 'vitest'

import { nativeSwapChainIds, nativeSwapEnabledChains } from '../NativeSwapChain'
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

  it('maps THORChain secured-asset hyphen denoms to secured (dash) notation', () => {
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'btc-btc',
        ticker: 'BTC',
      })
    ).toBe('BTC-BTC')
    expect(
      toNativeSwapAsset({
        chain: Chain.THORChain,
        id: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        ticker: 'USDC',
      })
    ).toBe('ETH-USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
  })

  it('derives secured-asset denom prefixes from nativeSwapChainIds', () => {
    for (const swapId of new Set(Object.values(nativeSwapChainIds))) {
      expect(
        toNativeSwapAsset({
          chain: Chain.THORChain,
          id: `${swapId.toLowerCase()}-asset`,
          ticker: 'ASSET',
        })
      ).toBe(`${swapId}-ASSET`)
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

describe('toNativeSwapAsset — fee-coin ticker matches the THORChain/MayaChain pool asset (oracle)', () => {
  // The fee-coin branch of toNativeSwapAsset interpolates `chainFeeCoin[chain].ticker`
  // directly into `<swapChainId>.<ticker>` (e.g. "BSC.BNB"). That ticker is a DISPLAY
  // value that can be rebranded (as Ton -> Toncoin's ticker became "GRAM"), while the
  // THORChain/MayaChain pool asset symbol is protocol-stable and does NOT follow a
  // rebrand. This oracle is independently pinned (NOT derived from chainFeeCoin) so a
  // future rebrand of a native-swap chain's display ticker fails this test instead of
  // silently emitting a wrong asset string at quote time. See vultisig-sdk#1697.
  const thorchainPoolAssetTicker: Partial<Record<Chain, string>> = {
    [Chain.Avalanche]: 'AVAX',
    [Chain.BitcoinCash]: 'BCH',
    [Chain.BSC]: 'BNB',
    [Chain.Bitcoin]: 'BTC',
    [Chain.Dogecoin]: 'DOGE',
    [Chain.Ethereum]: 'ETH',
    [Chain.Cosmos]: 'ATOM',
    [Chain.Litecoin]: 'LTC',
    [Chain.THORChain]: 'RUNE',
    [Chain.MayaChain]: 'CACAO',
    [Chain.Ripple]: 'XRP',
    [Chain.Base]: 'ETH',
    [Chain.Solana]: 'SOL',
    [Chain.Tron]: 'TRX',
    [Chain.Noble]: 'USDC',
    [Chain.Kujira]: 'KUJI',
    [Chain.Dash]: 'DASH',
    [Chain.Arbitrum]: 'ETH',
    [Chain.Zcash]: 'ZEC',
    [Chain.Cardano]: 'ADA',
  }

  it('every native-swap-enabled chain has a pinned oracle entry (no chain silently unguarded)', () => {
    for (const chain of nativeSwapEnabledChains) {
      expect(thorchainPoolAssetTicker[chain], `${chain} missing from the oracle table`).toBeDefined()
    }
  })

  it('chainFeeCoin ticker matches the pinned pool asset ticker for every native-swap-enabled chain', () => {
    for (const chain of nativeSwapEnabledChains) {
      const expected = thorchainPoolAssetTicker[chain]
      expect(chainFeeCoin[chain].ticker, `${chain} fee-coin ticker drifted from its THORChain/MayaChain pool asset`).toBe(
        expected
      )
    }
  })

  it('reproduces the bug class: a rebranded fee-coin ticker would build the wrong asset string', () => {
    // Ton is NOT in nativeSwapEnabledChains today (the guard above only covers
    // enabled chains), so this directly demonstrates what the guard is for:
    // chainFeeCoin[Ton].ticker is "GRAM" post-rebrand, but the correct THORChain
    // notation for TON's native asset is "TON.TON", not "TON.GRAM".
    expect(chainFeeCoin[Chain.Ton].ticker).toBe('GRAM')
    expect(chainFeeCoin[Chain.Ton].ticker).not.toBe('TON')
  })
})
