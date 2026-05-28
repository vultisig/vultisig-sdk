import { describe, expect, it } from 'vitest'

import { aggregatorPreferenceOrder } from '../findSwapQuote'

// Phase 1 (SDK scaffold only) — CowSwap is deliberately NOT registered as a
// live fetcher in `findSwapQuote` until Phase 2 wires the build/sign path
// through `getCowSwapOrder` + `submitCowSwapOrder`. Registering it before the
// consumer pipeline can sign would let CowSwap win a quote and then fail at
// sign time. (#584 round-1 — Ehsan)
//
// This test file pins the Phase 1 invariants so an accidental Phase 1 wiring
// during a future merge would be caught here, not by a user.

describe('CowSwap — Phase 1 invariants (#471 / #584)', () => {
  it('aggregatorPreferenceOrder does NOT include CowSwap until Phase 2', () => {
    expect(aggregatorPreferenceOrder.includes('CowSwap' as never)).toBe(false)
  })

  it('cowswap module is importable and the scaffolded helpers exist', async () => {
    const config = await import('@vultisig/core-chain/swap/general/cowswap/config')
    expect(config.cowSwapChainConfig).toBeDefined()
    expect(config.cowSwapSupportedChains).toBeDefined()
    expect(Array.isArray(config.cowSwapSupportedChains)).toBe(true)

    const quote = await import('@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote')
    expect(typeof quote.getCowSwapQuote).toBe('function')

    const submit = await import('@vultisig/core-chain/swap/general/cowswap/api/submitCowSwapOrder')
    expect(typeof submit.submitCowSwapOrder).toBe('function')

    const status = await import('@vultisig/core-chain/swap/general/cowswap/api/getCowSwapOrderStatus')
    expect(typeof status.getCowSwapOrderStatus).toBe('function')

    const order = await import('@vultisig/core-chain/swap/general/cowswap/sign/buildCowSwapOrder')
    expect(typeof order.buildCowSwapOrder).toBe('function')
  })
})
