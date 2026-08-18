import { describe, expect, it } from 'vitest'

import { chainForCoinGeckoPlatform, coinGeckoPlatformForChain } from '@/tools/coingecko/platforms'

describe('CoinGecko platform registry', () => {
  it.each([
    ['Ethereum', 'ethereum'],
    ['Avalanche', 'avalanche'],
    ['Zksync', 'zksync'],
    ['Sei', 'sei-v2'],
    ['Ton', 'the-open-network'],
    ['Hyperliquid', 'hyperliquid'],
    ['Robinhood', 'robinhood'],
  ])('round-trips %s <-> %s', (chain, platform) => {
    expect(coinGeckoPlatformForChain(chain)).toBe(platform)
    expect(chainForCoinGeckoPlatform(platform)).toBe(chain)
  })

  it('returns undefined for unsupported inputs', () => {
    expect(coinGeckoPlatformForChain('NotAChain')).toBeUndefined()
    expect(chainForCoinGeckoPlatform('not-a-platform')).toBeUndefined()
  })
})
