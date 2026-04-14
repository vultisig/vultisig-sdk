import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { chainPrefixToChain, chainToLpPrefix, lpChainMap } from './lpChainMap'

describe('lpChainMap', () => {
  it('maps BTC to Bitcoin', () => {
    expect(lpChainMap.BTC).toBe(Chain.Bitcoin)
  })

  it('maps ETH to Ethereum', () => {
    expect(lpChainMap.ETH).toBe(Chain.Ethereum)
  })

  it('maps THOR to THORChain', () => {
    expect(lpChainMap.THOR).toBe(Chain.THORChain)
  })

  it('maps GAIA to Cosmos', () => {
    expect(lpChainMap.GAIA).toBe(Chain.Cosmos)
  })

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(lpChainMap)).toBe(true)
  })

  it('covers every supported LP chain (sanity floor)', () => {
    // Not exhaustive — just making sure the derivation from
    // thorchainLpChainCode didn't silently drop keys.
    const mustHave = ['BTC', 'ETH', 'BCH', 'LTC', 'DOGE', 'BSC', 'AVAX', 'THOR']
    for (const key of mustHave) {
      expect(lpChainMap[key]).toBeDefined()
    }
  })
})

describe('chainPrefixToChain', () => {
  it('resolves known prefixes', () => {
    expect(chainPrefixToChain('BTC')).toBe(Chain.Bitcoin)
    expect(chainPrefixToChain('ETH')).toBe(Chain.Ethereum)
    expect(chainPrefixToChain('DOGE')).toBe(Chain.Dogecoin)
  })

  it('is case-insensitive', () => {
    expect(chainPrefixToChain('btc')).toBe(Chain.Bitcoin)
    expect(chainPrefixToChain('Btc')).toBe(Chain.Bitcoin)
  })

  it('returns undefined for unknown prefixes', () => {
    expect(chainPrefixToChain('ZZZ')).toBeUndefined()
    expect(chainPrefixToChain('')).toBeUndefined()
  })
})

describe('chainToLpPrefix', () => {
  it('resolves known chains to their prefix', () => {
    expect(chainToLpPrefix(Chain.Bitcoin)).toBe('BTC')
    expect(chainToLpPrefix(Chain.Ethereum)).toBe('ETH')
    expect(chainToLpPrefix(Chain.THORChain)).toBe('THOR')
  })

  it('is the inverse of chainPrefixToChain for every entry', () => {
    for (const [prefix, chain] of Object.entries(lpChainMap)) {
      expect(chainToLpPrefix(chain)).toBe(prefix)
      expect(chainPrefixToChain(prefix)).toBe(chain)
    }
  })
})
