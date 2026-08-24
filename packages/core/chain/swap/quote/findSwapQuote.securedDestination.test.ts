import { Chain } from '@vultisig/core-chain/Chain'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findSwapQuote } from './findSwapQuote'

vi.mock('@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote', () => ({
  getSwapKitQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({
  getNativeSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt', () => ({
  getNativeSwapTradingHalt: vi.fn().mockResolvedValue(null),
}))

vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: vi.fn().mockResolvedValue(null),
}))

const from = {
  chain: Chain.Ethereum,
  id: '0xA0b86991c6218B36c1D19D4A2E9Eb0cE3606eB48',
  ticker: 'USDC',
  decimals: 6,
  address: '0xfrom',
}

const to = {
  chain: Chain.THORChain,
  id: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  ticker: 'USDC',
  decimals: 8,
  address: 'thor1qyqszqgpqyqszqgpqyqszqgpqyqszqgp55c9cr',
}

const poolQuote: NativeSwapQuote = {
  swapChain: Chain.THORChain,
  expected_amount_out: '99000000',
  expiry: 0,
  fees: { affiliate: '0', asset: 'ETH-USDC', outbound: '0', total: '1000000' },
  inbound_address: '0xinbound',
  memo: '=:ETH-USDC:thor1qyqszqgpqyqszqgpqyqszqgpqyqszqgp55c9cr',
  notes: '',
  outbound_delay_blocks: 0,
  outbound_delay_seconds: 0,
  recommended_min_amount_in: '0',
  warning: '',
}

describe('findSwapQuote secured destinations', () => {
  beforeEach(() => {
    vi.mocked(getNativeSwapQuote).mockResolvedValue(poolQuote)
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('excluded'))
  })

  it('keeps same-underlying secured destinations on the authoritative pool quote path', async () => {
    const quote = await findSwapQuote({
      from,
      to,
      amount: 1_000_000n,
      excludeProviders: ['MayaChain', 'SwapKit'],
    })

    expect(quote.quote).toEqual({ native: poolQuote })
    expect('native' in quote.quote).toBe(true)
    if (!('native' in quote.quote)) throw new Error('expected a native THORChain pool quote')
    expect(quote.quote.native.memo).toMatch(/^=:/)
    expect(quote.quote.native.memo).not.toContain('SECURE+')
    expect(getNativeSwapQuote).toHaveBeenCalledOnce()
    expect(getSwapKitQuote).not.toHaveBeenCalled()
    expect(getNativeSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        swapChain: Chain.THORChain,
        destination: to.address,
        from,
        to,
        amount: 1,
      })
    )
  })
})
