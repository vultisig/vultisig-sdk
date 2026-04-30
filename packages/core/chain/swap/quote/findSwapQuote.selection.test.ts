import { Chain } from '@vultisig/core-chain/Chain'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { getOneInchSwapQuote } from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import type { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findSwapQuote } from './findSwapQuote'

vi.mock('@vultisig/core-chain/swap/general/kyber/api/quote', () => ({
  getKyberSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote', () => ({
  getOneInchSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote', () => ({
  getLifiSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({
  getNativeSwapQuote: vi.fn(),
}))

const evmSameChainCoins = {
  from: {
    chain: Chain.Ethereum,
    address: '0xsender',
    id: '0xsrc',
    decimals: 18,
    ticker: 'SRC',
  },
  to: {
    chain: Chain.Ethereum,
    address: '0xsender',
    id: '0xdst',
    decimals: 6,
    ticker: 'DST',
  },
} as const

function minimalGeneralQuote(
  dstAmount: string,
  provider: 'kyber' | '1inch'
): GeneralSwapQuote {
  const base = {
    dstAmount,
    tx: {
      evm: {
        from: '0xsender',
        to: '0xrouter',
        data: '0x',
        value: '0',
      },
    },
  }
  return provider === 'kyber'
    ? { ...base, provider: 'kyber' }
    : { ...base, provider: '1inch' }
}

function minimalNativeQuote(swapChain: Chain, expected_amount_out: string): NativeSwapQuote {
  return {
    swapChain: swapChain as NativeSwapQuote['swapChain'],
    expected_amount_out,
    expiry: 0,
    fees: { affiliate: '0', asset: '0', outbound: '0', total: '0' },
    memo: '',
    notes: '',
    outbound_delay_blocks: 0,
    outbound_delay_seconds: 0,
    recommended_min_amount_in: '0',
    warning: '',
  }
}

describe('findSwapQuote parallel selection', () => {
  beforeEach(() => {
    vi.mocked(getKyberSwapQuote).mockReset()
    vi.mocked(getOneInchSwapQuote).mockReset()
    vi.mocked(getLifiSwapQuote).mockReset()
    vi.mocked(getNativeSwapQuote).mockReset()
  })

  it('picks a later preferred provider when its comparable output amount is higher', async () => {
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('100', 'kyber'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) =>
      minimalNativeQuote(swapChain, '500')
    )

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    expect('native' in quote.quote).toBe(true)
    if (!('native' in quote.quote)) {
      throw new Error('Expected native quote')
    }
    expect(quote.quote.native.expected_amount_out).toBe('500')
    expect(getKyberSwapQuote).toHaveBeenCalledTimes(1)
    expect(getNativeSwapQuote).toHaveBeenCalled()
  })

  it('does not let a failing provider hide a succeeding one', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('Kyber unavailable'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) =>
      minimalNativeQuote(swapChain, '100')
    )

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('native' in quote.quote)) {
      throw new Error('Expected native quote')
    }
    expect(quote.quote.native.expected_amount_out).toBe('100')
  })

  it('does not let a malformed provider amount hide a succeeding one', async () => {
    vi.mocked(getKyberSwapQuote).mockResolvedValue(
      minimalGeneralQuote('not-a-number', 'kyber')
    )
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) =>
      minimalNativeQuote(swapChain, '100')
    )

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('native' in quote.quote)) {
      throw new Error('Expected native quote')
    }
    expect(quote.quote.native.expected_amount_out).toBe('100')
  })

  it('breaks ties by earlier fetcher preference order', async () => {
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('200', 'kyber'))
    vi.mocked(getOneInchSwapQuote).mockResolvedValue(minimalGeneralQuote('200', '1inch'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    expect('general' in quote.quote).toBe(true)
    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('kyber')
  })

  it('when all providers fail, propagates the last fetcher error (legacy asyncFallbackChain behavior)', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('first fail'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('second fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('third fail'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.THORChain) {
        throw new Error('thor fail')
      }
      throw new Error('maya last error')
    })

    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    ).rejects.toThrow('maya last error')
  })

  it('maps dust threshold on the last fetcher error to the user-facing message', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('kyber fail'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('inch fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('lifi fail'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.THORChain) {
        throw new Error('thor fail')
      }
      throw new Error('quote below dust threshold')
    })

    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    ).rejects.toThrow('Swap amount too small. Please increase the amount to proceed.')
  })
})
