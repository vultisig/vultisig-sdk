import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { THORCHAIN_STREAMING_SLIPPAGE_THRESHOLD_BPS } from '../NativeSwapChain'

const queryUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: queryUrlMock,
}))

vi.mock('i18next', () => ({
  t: (key: string) => key,
}))

import { getNativeSwapQuote } from './getNativeSwapQuote'

const btcFrom = {
  chain: Chain.Bitcoin,
  ticker: 'BTC',
  decimals: 8,
  logo: 'btc',
  priceProviderId: 'bitcoin',
  address: 'bc1qtest',
} as AccountCoin

const ethTo = {
  chain: Chain.Ethereum,
  ticker: 'ETH',
  decimals: 18,
  logo: 'eth',
  priceProviderId: 'ethereum',
  address: '0x86d526d6624AbC0178cF7296cD538Ecc080A95F1',
} as AccountCoin

const baseOkBody = {
  expected_amount_out: '1000',
  expiry: 1_700_000_000,
  fees: {
    affiliate: '0',
    asset: 'BTC.BTC',
    outbound: '0',
    total: '100',
    total_bps: 50,
  },
  memo: '=:e:0x86d526d6624AbC0178cF7296cD538Ecc080A95F1',
  notes: '',
  outbound_delay_blocks: 0,
  outbound_delay_seconds: 0,
  recommended_min_amount_in: '0',
  warning: '',
}

describe('getNativeSwapQuote', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('THORChain: does not fetch streaming when fees.total_bps is within threshold', async () => {
    queryUrlMock.mockResolvedValueOnce({
      ...baseOkBody,
      fees: { ...baseOkBody.fees, total_bps: THORCHAIN_STREAMING_SLIPPAGE_THRESHOLD_BPS },
    })

    const quote = await getNativeSwapQuote({
      swapChain: Chain.THORChain,
      destination: ethTo.address,
      from: btcFrom,
      to: ethTo,
      amount: 1,
    })

    expect(quote.swapChain).toBe(Chain.THORChain)
    expect(queryUrlMock).toHaveBeenCalledTimes(1)
    const url = String(queryUrlMock.mock.calls[0][0])
    expect(url).toContain('streaming_interval=0')
    expect(url).not.toContain('streaming_quantity')
  })

  it('THORChain: skips streaming when total_bps is missing', async () => {
    queryUrlMock.mockResolvedValueOnce({
      ...baseOkBody,
      fees: {
        affiliate: '0',
        asset: 'BTC.BTC',
        outbound: '0',
        total: '100',
      },
    })

    await getNativeSwapQuote({
      swapChain: Chain.THORChain,
      destination: ethTo.address,
      from: btcFrom,
      to: ethTo,
      amount: 1,
    })

    expect(queryUrlMock).toHaveBeenCalledTimes(1)
  })

  it('THORChain: omits streaming_quantity in the streaming request when max_streaming_quantity is unset or zero', async () => {
    queryUrlMock
      .mockResolvedValueOnce({
        ...baseOkBody,
        fees: { ...baseOkBody.fees, total_bps: 400 },
        expected_amount_out: '1000',
      })
      .mockResolvedValueOnce({
        ...baseOkBody,
        fees: { ...baseOkBody.fees, total_bps: 20 },
        expected_amount_out: '2000',
        memo: '=:e:0x86d526d6624AbC0178cF7296cD538Ecc080A95F1:0/1/0',
      })

    await getNativeSwapQuote({
      swapChain: Chain.THORChain,
      destination: ethTo.address,
      from: btcFrom,
      to: ethTo,
      amount: 1,
    })

    const streamUrl = String(queryUrlMock.mock.calls[1][0])
    expect(streamUrl).toContain('streaming_interval=1')
    expect(streamUrl).not.toContain('streaming_quantity')
  })

  it('THORChain: fetches streaming when total_bps exceeds threshold and streaming output is higher', async () => {
    queryUrlMock
      .mockResolvedValueOnce({
        ...baseOkBody,
        fees: { ...baseOkBody.fees, total_bps: 301 },
        expected_amount_out: '1000',
        max_streaming_quantity: 7,
      })
      .mockResolvedValueOnce({
        ...baseOkBody,
        fees: { ...baseOkBody.fees, total_bps: 20 },
        expected_amount_out: '2000',
        memo: '=:e:0x86d526d6624AbC0178cF7296cD538Ecc080A95F1:0/1/7',
      })

    const quote = await getNativeSwapQuote({
      swapChain: Chain.THORChain,
      destination: ethTo.address,
      from: btcFrom,
      to: ethTo,
      amount: 1,
    })

    expect(quote.expected_amount_out).toBe('2000')
    expect(quote.memo).toContain(':0/1/7')
    expect(queryUrlMock).toHaveBeenCalledTimes(2)
    const streamUrl = String(queryUrlMock.mock.calls[1][0])
    expect(streamUrl).toContain('streaming_interval=1')
    expect(streamUrl).toContain('streaming_quantity=7')
  })

  it('THORChain: keeps rapid when streaming expected_amount_out is not better', async () => {
    queryUrlMock
      .mockResolvedValueOnce({
        ...baseOkBody,
        fees: { ...baseOkBody.fees, total_bps: 400 },
        expected_amount_out: '5000',
        max_streaming_quantity: 3,
      })
      .mockResolvedValueOnce({
        ...baseOkBody,
        fees: { ...baseOkBody.fees, total_bps: 20 },
        expected_amount_out: '1000',
        memo: '=:e:0x86d526d6624AbC0178cF7296cD538Ecc080A95F1:0/1/3',
      })

    const quote = await getNativeSwapQuote({
      swapChain: Chain.THORChain,
      destination: ethTo.address,
      from: btcFrom,
      to: ethTo,
      amount: 1,
    })

    expect(quote.expected_amount_out).toBe('5000')
    expect(queryUrlMock).toHaveBeenCalledTimes(2)
  })

  it('THORChain: falls back to rapid when streaming quote throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    queryUrlMock
      .mockResolvedValueOnce({
        ...baseOkBody,
        fees: { ...baseOkBody.fees, total_bps: 400 },
        expected_amount_out: '5000',
        max_streaming_quantity: 2,
      })
      .mockRejectedValueOnce(new Error('network'))

    const quote = await getNativeSwapQuote({
      swapChain: Chain.THORChain,
      destination: ethTo.address,
      from: btcFrom,
      to: ethTo,
      amount: 1,
    })

    expect(quote.expected_amount_out).toBe('5000')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
