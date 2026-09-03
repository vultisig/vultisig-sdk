import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { isSwapKitSourceChain, swapKitEnabledChains, swapKitSourceChains } from './SwapKitEnabledChains'

describe('SwapKit chain eligibility', () => {
  it('ships HyperEVM in both directions and Robinhood as destination-only', () => {
    expect(swapKitSourceChains).toContain(Chain.Hyperliquid)
    expect(swapKitEnabledChains).toContain(Chain.Hyperliquid)
    expect(swapKitEnabledChains).toContain(Chain.Robinhood)
    expect(swapKitSourceChains).not.toContain(Chain.Robinhood)
    expect(isSwapKitSourceChain(Chain.Robinhood)).toBe(false)
  })

  it('opens catalog-driven EVM sources only when Blockaid already covers them', () => {
    expect(swapKitSourceChains).not.toContain(Chain.Blast)
    expect(isSwapKitSourceChain(Chain.Blast)).toBe(true)
    expect(isSwapKitSourceChain(Chain.CronosChain)).toBe(false)
  })
})
