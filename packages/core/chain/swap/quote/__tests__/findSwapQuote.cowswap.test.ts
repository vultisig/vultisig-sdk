import { describe, expect, it } from 'vitest'

import { providerPreferenceOrder } from '../findSwapQuote'

// Phase 2 (#471 / #584 / #3930) — CowSwap is now wired as a live fetcher in
// `findSwapQuote`: the consumer pipeline can rebuild the order's EIP-712 digest,
// sign it via MPC, and submit it through `submitCowSwapOrder`. These tests pin
// the Phase 2 invariants (registration + preference ranking) so an accidental
// regression is caught here, not by a user.

describe('CowSwap — Phase 2 invariants (#471 / #584 / #3930)', () => {
  it('providerPreferenceOrder includes CowSwap', () => {
    expect(providerPreferenceOrder.includes('CowSwap')).toBe(true)
  })

  it('ranks CowSwap first — MEV-protected, gas-less fills win exact-output ties', () => {
    expect(providerPreferenceOrder[0]).toBe('CowSwap')
  })

  it('cowswap module is importable and the Phase 2 helpers exist', async () => {
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

    const typedData = await import('@vultisig/core-chain/swap/general/cowswap/sign/buildCowSwapOrderTypedData')
    expect(typeof typedData.buildCowSwapOrderTypedData).toBe('function')

    const keysignData = await import('@vultisig/core-chain/swap/general/cowswap/keysign/cowSwapKeysignData')
    expect(typeof keysignData.encodeCowSwapKeysignData).toBe('function')
    expect(typeof keysignData.decodeCowSwapKeysignData).toBe('function')
  })
})
