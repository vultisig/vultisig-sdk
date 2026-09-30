import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { chainForCoinGeckoPlatform, coinGeckoPlatformForChain, coinGeckoPlatforms } from '@/tools/coingecko/platforms'

const expectedPlatforms = [
  [Chain.Ethereum, 'ethereum'],
  [Chain.BSC, 'binance-smart-chain'],
  [Chain.Polygon, 'polygon-pos'],
  [Chain.Avalanche, 'avalanche'],
  [Chain.Arbitrum, 'arbitrum-one'],
  [Chain.Optimism, 'optimistic-ethereum'],
  [Chain.Base, 'base'],
  [Chain.Blast, 'blast'],
  [Chain.Mantle, 'mantle'],
  [Chain.Robinhood, 'robinhood'],
  [Chain.Zksync, 'zksync'],
  [Chain.CronosChain, 'cronos'],
  [Chain.Hyperliquid, 'hyperliquid'],
  [Chain.Sei, 'sei-v2'],
  [Chain.Solana, 'solana'],
  [Chain.Tron, 'tron'],
  [Chain.Ripple, 'ripple'],
  [Chain.Cosmos, 'cosmos'],
  [Chain.Osmosis, 'osmosis'],
  [Chain.THORChain, 'thorchain'],
  [Chain.Sui, 'sui'],
  [Chain.Ton, 'the-open-network'],
  [Chain.Cardano, 'cardano'],
  [Chain.Polkadot, 'polkadot'],
] as const

describe('CoinGecko platforms', () => {
  it.each(expectedPlatforms)('round trips %s through %s', (chain, platform) => {
    expect(coinGeckoPlatformForChain(chain)).toBe(platform)
    expect(chainForCoinGeckoPlatform(platform)).toBe(chain)
  })

  it('covers the complete registry with unique chains and platforms', () => {
    expect(coinGeckoPlatforms).toEqual(expectedPlatforms)
    expect(new Set(coinGeckoPlatforms.map(([chain]) => chain)).size).toBe(coinGeckoPlatforms.length)
    expect(new Set(coinGeckoPlatforms.map(([, platform]) => platform)).size).toBe(coinGeckoPlatforms.length)
  })

  it('ignores unsupported IDs and object prototype names', () => {
    for (const unknown of ['unknown-platform', 'toString', '__proto__']) {
      expect(coinGeckoPlatformForChain(unknown)).toBeUndefined()
      expect(chainForCoinGeckoPlatform(unknown)).toBeUndefined()
    }
    for (const stale of ['avalanche-c-chain', 'zksync-era', 'sei', 'sei-network']) {
      expect(chainForCoinGeckoPlatform(stale)).toBeUndefined()
    }
  })
})
