import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

import {
  createThorchainSecuredAssetCatalog,
  getThorchainSecuredAssetL1Asset,
  getThorchainSwapDestinationAssets,
  parseThorchainSecuredAssets,
  thorchainSecuredAssetFallback,
} from './securedAssets'

describe('THORChain secured-asset catalog', () => {
  it('maps and deduplicates the live THORChain response', () => {
    const assets = parseThorchainSecuredAssets([
      { asset: 'BTC-BTC', supply: '1', depth: '1' },
      {
        asset: 'ETH-USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        supply: '2',
        depth: '2',
      },
      { asset: 'BTC-BTC', supply: '1', depth: '1' },
      {
        asset: 'TRON-USDT-TR7NHQJEKQXGTCI8Q8ZY4PL8OTSZGJLJ6T',
        supply: '3',
        depth: '3',
      },
    ])

    expect(assets).toHaveLength(3)
    expect(assets[0]).toMatchObject({
      chain: Chain.THORChain,
      id: 'btc-btc',
      ticker: 'BTC',
      decimals: 8,
      l1Asset: 'BTC.BTC',
      isSecured: true,
      supply: '1',
      depth: '1',
    })
    expect(assets[1]).toMatchObject({
      id: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      ticker: 'USDC',
      priceProviderId: 'usd-coin',
      l1Asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
    })
    expect(assets[2]).toMatchObject({
      id: 'tron-usdt-tr7nhqjekqxgtci8q8zy4pl8otszgjlj6t',
      ticker: 'USDT',
      l1Asset: 'TRON.USDT-TR7NHQJEKQXGTCI8Q8ZY4PL8OTSZGJLJ6T',
    })
  })

  it('keeps newly introduced chain prefixes in the live catalog', () => {
    expect(parseThorchainSecuredAssets([{ asset: 'NEWCHAIN-COIN', supply: '1', depth: '1' }])).toEqual([
      expect.objectContaining({
        id: 'newchain-coin',
        ticker: 'COIN',
        l1Asset: 'NEWCHAIN.COIN',
      }),
    ])
  })

  it('fails closed on a malformed live response rather than returning a partial list', () => {
    expect(() =>
      parseThorchainSecuredAssets([
        { asset: 'BTC-BTC', supply: '1', depth: '1' },
        { asset: 'not/a-chain', supply: '1', depth: '1' },
      ])
    ).toThrow(/invalid secured asset/)
    expect(() => parseThorchainSecuredAssets([{ asset: 'BTC-BTC', supply: 'not-a-number', depth: '1' }])).toThrow(
      /invalid supply/
    )
  })

  it('uses the static catalog only when the live read fails', async () => {
    const getCatalog = createThorchainSecuredAssetCatalog({
      fetchJson: async () => {
        throw new Error('offline')
      },
    })

    const catalog = await getCatalog()

    expect(catalog.source).toBe('fallback')
    expect(catalog.assets).toEqual(thorchainSecuredAssetFallback)
    expect(catalog.assets.length).toBeGreaterThan(10)
  })

  it('builds the picker universe from non-secured static tokens plus the dynamic secured catalog', async () => {
    const dynamic = parseThorchainSecuredAssets([{ asset: 'NEWCHAIN-COIN', supply: '1', depth: '1' }])

    const assets = await getThorchainSwapDestinationAssets({
      fetchCatalog: async () => ({ source: 'thorchain', assets: dynamic }),
    })

    expect(assets).toContainEqual(expect.objectContaining({ id: 'newchain-coin', l1Asset: 'NEWCHAIN.COIN' }))
    expect(assets).toContainEqual(expect.objectContaining({ id: 'x/staking-x/ruji', ticker: 'sRUJI' }))
    expect(assets).not.toContainEqual(expect.objectContaining({ id: 'btc-btc' }))
  })

  it('coalesces concurrent reads, caches snapshots, and supports force refresh', async () => {
    const fetchJson = vi.fn(async () => [{ asset: 'BTC-BTC', supply: '1', depth: '1' }])
    const getCatalog = createThorchainSecuredAssetCatalog({ fetchJson })

    const [first, second] = await Promise.all([getCatalog(), getCatalog()])
    await getCatalog()
    await getCatalog({ forceRefresh: true })

    expect(first).toEqual(second)
    expect(fetchJson).toHaveBeenCalledTimes(2)
    expect(first.source).toBe('thorchain')
  })

  it('resolves the L1 identity only for valid THORChain secured denoms', () => {
    expect(
      getThorchainSecuredAssetL1Asset({
        chain: Chain.THORChain,
        id: 'base-usdc-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      })
    ).toBe('BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913')
    expect(getThorchainSecuredAssetL1Asset({ chain: Chain.THORChain, id: 'x/ruji' })).toBeNull()
    expect(
      getThorchainSecuredAssetL1Asset({
        chain: Chain.Ethereum,
        id: 'eth-usdc-0xabc',
      })
    ).toBeNull()
  })
})
