import { describe, expect, it } from 'vitest'

import { Chain } from '../../Chain'
import { buildLimitSwapMemo } from './limitSwapMemo'
import {
  getThorchainMemoAsset,
  isThorchainRoutable,
  isThorchainSecuredAssetId,
  thorchainAssetPrefixToChain,
  thorchainMemoAssetChainPrefix,
} from './thorchainMemoAsset'

// Real mainnet USDC. Last 6 characters are `06eb48`, so the memo suffix is `06EB48`.
const usdcContract = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

describe('getThorchainMemoAsset', () => {
  describe('native assets', () => {
    it.each([
      [Chain.Bitcoin, 'BTC', 'BTC.BTC'],
      [Chain.Ethereum, 'ETH', 'ETH.ETH'],
      [Chain.THORChain, 'RUNE', 'THOR.RUNE'],
      [Chain.Cosmos, 'ATOM', 'GAIA.ATOM'],
      [Chain.Dogecoin, 'DOGE', 'DOGE.DOGE'],
      [Chain.Avalanche, 'AVAX', 'AVAX.AVAX'],
    ])('encodes %s as CHAIN.TICKER', (chain, ticker, expected) => {
      expect(getThorchainMemoAsset({ chain, ticker })).toBe(expected)
    })

    it('treats an empty id as native', () => {
      expect(getThorchainMemoAsset({ chain: Chain.Bitcoin, ticker: 'BTC', id: '   ' })).toBe('BTC.BTC')
    })
  })

  describe('tokens', () => {
    it('suffixes an EVM token with the last 6 contract chars, uppercased', () => {
      expect(getThorchainMemoAsset({ chain: Chain.Ethereum, ticker: 'USDC', id: usdcContract })).toBe('ETH.USDC-06EB48')
    })

    it('uppercases a suffix that is already partly uppercase', () => {
      expect(getThorchainMemoAsset({ chain: Chain.BSC, ticker: 'CAKE', id: '0xAbCdEf123456' })).toBe('BSC.CAKE-123456')
    })

    it('rejects an id too short to form a suffix', () => {
      expect(() => getThorchainMemoAsset({ chain: Chain.Ethereum, ticker: 'FOO', id: '0x123' })).toThrow(
        /shorter than 6 characters/
      )
    })
  })

  describe('THORChain-held assets', () => {
    it('returns a secured asset denom verbatim', () => {
      expect(getThorchainMemoAsset({ chain: Chain.THORChain, ticker: 'USDC', id: `eth-usdc-${usdcContract}` })).toBe(
        `eth-usdc-${usdcContract}`
      )
    })

    it('returns a short secured denom verbatim rather than applying the 6-char suffix rule', () => {
      expect(getThorchainMemoAsset({ chain: Chain.THORChain, ticker: 'XRP', id: 'xrp-xrp' })).toBe('xrp-xrp')
    })

    it.each([
      ['tcy', 'TCY', 'THOR.TCY'],
      ['ruji', 'RUJI', 'THOR.RUJI'],
    ])('encodes non-secured THORChain token %s as THOR.TICKER', (id, ticker, expected) => {
      expect(getThorchainMemoAsset({ chain: Chain.THORChain, ticker, id })).toBe(expected)
    })

    it('treats an x/ synth as a normal THORChain token, not a secured asset', () => {
      expect(getThorchainMemoAsset({ chain: Chain.THORChain, ticker: 'sBTC', id: 'x/btc-btc' })).toBe('THOR.sBTC')
    })
  })

  describe('rejections', () => {
    it.each([Chain.Cardano, Chain.Sui, Chain.Polkadot])('throws for non-routable chain %s', chain => {
      expect(() => getThorchainMemoAsset({ chain, ticker: 'FOO' })).toThrow(/not routable through THORChain/)
    })

    it.each(['', '   '])('throws for blank ticker %j', ticker => {
      expect(() => getThorchainMemoAsset({ chain: Chain.Bitcoin, ticker })).toThrow(/ticker must be a non-empty/)
    })
  })

  it('trims surrounding whitespace from ticker and id', () => {
    expect(getThorchainMemoAsset({ chain: Chain.Ethereum, ticker: '  USDC  ', id: `  ${usdcContract}  ` })).toBe(
      'ETH.USDC-06EB48'
    )
  })
})

describe('isThorchainSecuredAssetId', () => {
  it.each([
    ['eth-usdc-0xa0b8', true],
    ['xrp-xrp', true],
    ['tcy', false],
    ['x/btc-btc', false],
  ])('%s -> %s', (id, expected) => {
    expect(isThorchainSecuredAssetId(id)).toBe(expected)
  })
})

describe('isThorchainRoutable', () => {
  it.each([Chain.Bitcoin, Chain.Ethereum, Chain.THORChain, Chain.Cosmos, Chain.Solana, Chain.Noble, Chain.Ripple])(
    'accepts %s',
    chain => {
      expect(isThorchainRoutable(chain)).toBe(true)
    }
  )

  it.each([Chain.Cardano, Chain.Sui, Chain.Polkadot, Chain.MayaChain])('rejects %s', chain => {
    expect(isThorchainRoutable(chain)).toBe(false)
  })
})

describe('prefix map consistency', () => {
  // Drift between the two directions is a fund-safety bug: the memo is the
  // order, so a prefix one direction accepts and the other rejects either
  // blocks a valid order or routes one somewhere unintended.
  it('round-trips every routable chain through prefix and back', () => {
    Object.entries(thorchainMemoAssetChainPrefix).forEach(([chain, prefix]) => {
      expect(thorchainAssetPrefixToChain[prefix as string]).toBe(chain)
    })
  })

  it('assigns a unique prefix per chain', () => {
    const prefixes = Object.values(thorchainMemoAssetChainPrefix)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('produces assets the limit-swap memo builder accepts', () => {
    const source = getThorchainMemoAsset({ chain: Chain.Bitcoin, ticker: 'BTC' })
    const target = getThorchainMemoAsset({ chain: Chain.Ethereum, ticker: 'USDC', id: usdcContract })

    const memo = buildLimitSwapMemo({
      source_asset: source,
      source_amount: 100_000_000,
      target_asset: target,
      dest_addr: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      target_price: 16,
      expiry_hours: 24,
    })

    expect(memo.startsWith(`=<:${target}:`)).toBe(true)
  })
})
