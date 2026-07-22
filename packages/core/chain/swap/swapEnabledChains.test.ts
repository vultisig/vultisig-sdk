import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { cowSwapSupportedChains } from './general/cowswap/config'
import { jupiterSwapEnabledChains } from './general/jupiter/JupiterSwapEnabledChains'
import { kyberSwapEnabledChains } from './general/kyber/chains'
import { lifiSwapEnabledChains } from './general/lifi/LifiSwapEnabledChains'
import { oneInchSwapEnabledChains } from './general/oneInch/OneInchSwapEnabledChains'
import { swapKitEnabledChains } from './general/swapkit/SwapKitEnabledChains'
import { nativeSwapEnabledChains } from './native/NativeSwapChain'
import { swapEnabledChains } from './swapEnabledChains'

describe('swapEnabledChains aggregate (sdk#1151)', () => {
  // The aggregate must be a superset of EVERY provider's enabled-chain list.
  // It previously omitted Kyber/Jupiter/CowSwap and was complete only because
  // LiFi's list happened to be a superset — a hidden invariant the first
  // non-LiFi-served chain would have silently broken, under-reporting
  // isSwapSupported/getSupportedChains.
  const providerLists: Record<string, readonly Chain[]> = {
    native: nativeSwapEnabledChains,
    oneInch: oneInchSwapEnabledChains,
    kyber: kyberSwapEnabledChains,
    lifi: lifiSwapEnabledChains,
    swapKit: swapKitEnabledChains,
    jupiter: jupiterSwapEnabledChains,
    cowSwap: cowSwapSupportedChains,
  }

  it.each(Object.entries(providerLists))('covers every %s chain', (_provider, chains) => {
    const aggregate = new Set<Chain>(swapEnabledChains)
    for (const chain of chains) {
      expect(aggregate.has(chain), `${chain} missing from swapEnabledChains`).toBe(true)
    }
  })
})

describe('kyberSwapEnabledChains (sdk#1151)', () => {
  it('does not list Zksync/Blast — Kyber /routes 404s on both (verified 2026-07-08)', () => {
    // Listing them only burned a doomed fetch + a 30s-capped timeout slot on
    // every quote for those chains; see knownAggregatorRouters.ts.
    const chains = new Set<Chain>(kyberSwapEnabledChains)
    expect(chains.has(Chain.Zksync)).toBe(false)
    expect(chains.has(Chain.Blast)).toBe(false)
  })

  it('keeps the 7 verified-live chains', () => {
    expect([...kyberSwapEnabledChains].sort()).toEqual(
      [Chain.Ethereum, Chain.BSC, Chain.Arbitrum, Chain.Polygon, Chain.Optimism, Chain.Avalanche, Chain.Base].sort()
    )
  })
})
