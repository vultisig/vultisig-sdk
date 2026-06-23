import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import type { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

const makeQuote = (expiry: number): NativeSwapQuote =>
  ({
    swapChain: Chain.THORChain,
    expected_amount_out: '100000',
    expiry,
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
    warning: '',
  }) as NativeSwapQuote

const quote = {
  swapChain: Chain.THORChain,
  expected_amount_out: '100000',
  expiry: 1_700_100_000,
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the quote expiry instead of minting a fresh window', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const payload = nativeSwapQuoteToSwapPayload({
      quote: makeQuote(1_700_000_600),
      fromCoin,
      toCoin,
      amount: 1_000n,
    })

    expect(payload.case).toBe('thorchainSwapPayload')
    if (payload.case !== 'thorchainSwapPayload') {
      throw new Error('Expected THORChain swap payload')
    }
    expect(payload.value.expirationTime).toBe(1_700_000_600n)
  })

  it('rejects expired native swap quotes before signing', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    expect(() =>
      nativeSwapQuoteToSwapPayload({
        quote: makeQuote(1_699_999_999),
        fromCoin,
        toCoin,
        amount: 1_000n,
      })
    ).toThrow(/expired/)
  })

  it('sets a non-zero minimum output limit from quote tolerance bps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

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
  it('keeps a non-zero limit for positive outputs when tolerance is below 100%', () => {
    expect(
      getNativeSwapToAmountLimit({
        expectedAmountOut: '1',
        slippageToleranceBps: 100,
      })
    ).toBe('1')
  })

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
