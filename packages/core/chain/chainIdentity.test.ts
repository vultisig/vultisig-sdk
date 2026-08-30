import { describe, expect, it } from 'vitest'

import { Chain } from './Chain'
import { chainFromChainId, chainIds, isChainId, toChainId, toNativeAssetId } from './chainIdentity'

describe('chainIdentity', () => {
  it('covers every Chain with a unique CAIP-2 id', () => {
    const chains = Object.values(Chain)
    const ids = chains.map(toChainId)

    expect(ids).toHaveLength(chains.length)
    expect(new Set(ids).size).toBe(chains.length)
    expect(Object.keys(chainIds).sort()).toEqual([...chains].sort())
  })

  it('disambiguates Terra vs TerraClassic without a network probe', () => {
    expect(toChainId(Chain.Terra)).toBe('cosmos:phoenix-1')
    expect(toChainId(Chain.TerraClassic)).toBe('cosmos:columbus-5')
    expect(toChainId(Chain.Terra)).not.toBe(toChainId(Chain.TerraClassic))
    expect(chainFromChainId('cosmos:phoenix-1')).toBe(Chain.Terra)
    expect(chainFromChainId('cosmos:columbus-5')).toBe(Chain.TerraClassic)
  })

  it('gives Terra and TerraClassic distinct native asset ids (same uluna denom, different ChainId)', () => {
    expect(toNativeAssetId(Chain.Terra)).toBe('cosmos:phoenix-1/native:LUNA')
    expect(toNativeAssetId(Chain.TerraClassic)).toBe('cosmos:columbus-5/native:LUNC')
    expect(toNativeAssetId(Chain.Terra)).not.toBe(toNativeAssetId(Chain.TerraClassic))
  })

  it('derives EVM ids from the existing eip155 chain-id table', () => {
    expect(toChainId(Chain.Ethereum)).toBe('eip155:1')
    expect(toChainId(Chain.Polygon)).toBe('eip155:137')
    expect(toChainId(Chain.Hyperliquid)).toBe('eip155:999')
    expect(toChainId(Chain.Robinhood)).toBe('eip155:4663')
  })

  it('uses the canonical TVM CAIP-2 id for TON', () => {
    expect(toChainId(Chain.Ton)).toBe('tvm:-239')
    expect(chainFromChainId('tvm:-239')).toBe(Chain.Ton)
    expect(isChainId('tvm:-239')).toBe(true)
  })

  it('round-trips every chain through chainFromChainId', () => {
    for (const chain of Object.values(Chain)) {
      expect(chainFromChainId(toChainId(chain))).toBe(chain)
      expect(isChainId(toChainId(chain))).toBe(true)
    }
    expect(chainFromChainId('cosmos:not-a-real-chain')).toBeUndefined()
    expect(isChainId('nope')).toBe(false)
  })
})
