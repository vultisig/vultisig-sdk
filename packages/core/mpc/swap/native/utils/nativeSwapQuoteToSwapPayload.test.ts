import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import type { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { describe, expect, it } from 'vitest'

import { getNativeSwapToAmountLimit, nativeSwapQuoteToSwapPayload } from './nativeSwapQuoteToSwapPayload'

const fromCoin = {
  chain: Chain.Bitcoin,
  ticker: 'BTC',
  decimals: 8,
  address: 'bc1qfrom',
  hexPublicKey: 'abcd',
} as AccountCoin & { hexPublicKey: string }

const toCoin = {
  chain: Chain.Ethereum,
  ticker: 'ETH',
  decimals: 18,
  address: '0xto',
  hexPublicKey: 'abcd',
} as AccountCoin & { hexPublicKey: string }

const quote = {
  swapChain: Chain.THORChain,
  expected_amount_out: '100000',
  expiry: 1_700_000_000,
  fees: {
    affiliate: '0',
    asset: 'BTC.BTC',
    outbound: '0',
    total: '100',
  },
  inbound_address: 'bc1qinbound',
  memo: '=:ETH.ETH:0xto',
  notes: '',
  outbound_delay_blocks: 0,
  outbound_delay_seconds: 0,
  recommended_min_amount_in: '0',
  liquidity_tolerance_bps: 250,
  warning: '',
} as NativeSwapQuote

describe('nativeSwapQuoteToSwapPayload', () => {
  it('sets a non-zero minimum output limit from quote tolerance bps', () => {
    const payload = nativeSwapQuoteToSwapPayload({
      quote,
      fromCoin,
      toCoin,
      amount: 1_000n,
    })

    expect(payload.case).toBe('thorchainSwapPayload')
    if (payload.case !== 'thorchainSwapPayload') {
      throw new Error('Expected THORChain swap payload')
    }
    expect(payload.value.toAmountLimit).toBe('97500')
  })
})

describe('getNativeSwapToAmountLimit', () => {
  it('floors expected output by tolerance basis points', () => {
    expect(
      getNativeSwapToAmountLimit({
        expectedAmountOut: '1000',
        slippageToleranceBps: 100,
      })
    ).toBe('990')
  })

  it('uses the shared native default when persisted quotes do not include tolerance bps', () => {
    expect(getNativeSwapToAmountLimit({ expectedAmountOut: '1000' })).toBe('990')
  })

  it('rejects invalid tolerance bps', () => {
    expect(() =>
      getNativeSwapToAmountLimit({
        expectedAmountOut: '1000',
        slippageToleranceBps: 10_001,
      })
    ).toThrow(/slippageToleranceBps/)
  })
})
