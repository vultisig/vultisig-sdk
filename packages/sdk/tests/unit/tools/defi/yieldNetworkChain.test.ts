import { describe, expect, it } from 'vitest'

import {
  yieldNetworkToCanonicalChain,
  yieldNetworkToEvmChain,
} from '@/tools/defi/stakekit/yieldNetworkChain'

describe('yieldNetworkToCanonicalChain', () => {
  it('maps EVM network slugs to their PascalCase chain name', () => {
    expect(yieldNetworkToCanonicalChain('ethereum')).toBe('Ethereum')
    expect(yieldNetworkToCanonicalChain('avalanche-c')).toBe('Avalanche')
    expect(yieldNetworkToCanonicalChain('binance')).toBe('BSC')
  })

  it('also maps non-EVM network slugs', () => {
    expect(yieldNetworkToCanonicalChain('solana')).toBe('Solana')
    expect(yieldNetworkToCanonicalChain('sui')).toBe('Sui')
    expect(yieldNetworkToCanonicalChain('tron')).toBe('Tron')
    expect(yieldNetworkToCanonicalChain('ton')).toBe('Ton')
  })

  it('returns null for an unrecognized network', () => {
    expect(yieldNetworkToCanonicalChain('not-a-real-network')).toBeNull()
  })
})

describe('yieldNetworkToEvmChain', () => {
  it('agrees with yieldNetworkToCanonicalChain for every EVM network', () => {
    // sdk#1953: single canonical mapping backs both entry points.
    for (const network of ['ethereum', 'arbitrum', 'base', 'optimism', 'polygon', 'avalanche-c', 'binance', 'cronos', 'zksync', 'sei']) {
      expect(yieldNetworkToEvmChain(network)).toBe(yieldNetworkToCanonicalChain(network))
    }
  })

  it('fails closed (null) for a non-EVM network, unlike the broader canonical helper', () => {
    // A scan-request builder that only understands EVM shapes must not fall
    // through into EVM calldata parsing for a solana/sui/tron/ton network.
    expect(yieldNetworkToEvmChain('solana')).toBeNull()
    expect(yieldNetworkToCanonicalChain('solana')).toBe('Solana')
  })
})
