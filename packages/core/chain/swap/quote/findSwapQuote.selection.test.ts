import { Chain } from '@vultisig/core-chain/Chain'
import { getCowSwapQuote } from '@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote'
import type { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { getJupiterSwapQuote } from '@vultisig/core-chain/swap/general/jupiter/api/getJupiterSwapQuote'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { getOneInchSwapQuote } from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { SwapKitAmountBelowMinimumError } from '@vultisig/core-chain/swap/general/swapkit/SwapKitErrors'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { getNativeSwapTradingHalt } from '@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt'
import {
  getNativeSwapMinAmountIn,
  NativeSwapMinAmountIn,
} from '@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn'
import { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findSwapQuote } from './findSwapQuote'

vi.mock('@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote', () => ({
  getCowSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/kyber/api/quote', () => ({
  getKyberSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/jupiter/api/getJupiterSwapQuote', () => ({
  getJupiterSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote', () => ({
  getOneInchSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote', () => ({
  getLifiSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote', () => ({
  getSwapKitQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({
  getNativeSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt', () => ({
  getNativeSwapTradingHalt: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: vi.fn(),
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
  provider: 'kyber' | '1inch' | 'swapkit' | 'li.fi' | 'jupiter',
  tx: GeneralSwapQuote['tx'] = {
    evm: {
      from: '0xsender',
      to: '0xrouter',
      data: '0x',
      value: '0',
    },
  }
): GeneralSwapQuote {
  const base = {
    dstAmount,
    tx,
  }
  return { ...base, provider }
}

function minimalCowSwapQuote(dstAmount: string, sellAmount = '1000000000000000000'): GeneralSwapQuote {
  return {
    dstAmount,
    provider: 'cowswap',
    tx: {
      cowswap_order: {
        sellToken: '0xsrc',
        buyToken: '0xdst',
        receiver: '0xsender',
        sellAmount,
        buyAmount: dstAmount,
        validTo: 1,
        appData: '0x',
        appDataHash: '0x',
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
        chainId: 1,
        apiBase: 'https://api.cow.fi/mainnet',
      },
    },
  }
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
    vi.mocked(getCowSwapQuote).mockReset()
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('skip cowswap'))
    vi.mocked(getJupiterSwapQuote).mockReset()
    vi.mocked(getJupiterSwapQuote).mockRejectedValue(new Error('skip jupiter'))
    vi.mocked(getKyberSwapQuote).mockReset()
    vi.mocked(getOneInchSwapQuote).mockReset()
    vi.mocked(getLifiSwapQuote).mockReset()
    vi.mocked(getSwapKitQuote).mockReset()
    vi.mocked(getNativeSwapQuote).mockReset()
    vi.mocked(getNativeSwapTradingHalt).mockReset()
    vi.mocked(getNativeSwapMinAmountIn).mockReset()
    vi.mocked(getNativeSwapTradingHalt).mockResolvedValue(null)
    // Default: no proactive minimum signal unless a test opts in.
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(null)
  })

  it('picks a later preferred provider when its comparable output amount is higher', async () => {
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    // Destination has 6 decimals. Kyber dstAmount is already in token decimals.
    // Native THORChain amounts are 8-decimal canonical → rebase to 6: divide by 1e2.
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('150', 'kyber'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) =>
      // 20_000 in 8-decimal → 200.0 in 6-decimal units; beats Kyber 150.
      minimalNativeQuote(swapChain, '20000')
    )

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    expect('native' in quote.quote).toBe(true)
    if (!('native' in quote.quote)) {
      throw new Error('Expected native quote')
    }
    expect(quote.quote.native.expected_amount_out).toBe('20000')
    expect(getKyberSwapQuote).toHaveBeenCalledTimes(1)
    expect(getNativeSwapQuote).toHaveBeenCalled()
  })

  it('ranks by destination-decimal-normalized output among aggregators when no native route exists', async () => {
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('900000', 'swapkit'))
    // 1 USDC (6 decimals) on the general side via kyber — higher comparable output.
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'kyber'))
    // No native quote available — hard THOR priority doesn't apply.
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('native unavailable'))

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

  it('does not let a failing provider hide a succeeding one', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('Kyber unavailable'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => minimalNativeQuote(swapChain, '100'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('native' in quote.quote)) {
      throw new Error('Expected native quote')
    }
    expect(quote.quote.native.expected_amount_out).toBe('100')
  })

  it('reclassifies a SwapKit below-minimum rejection as "amount too small" (#4418)', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('native unavailable'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new SwapKitAmountBelowMinimumError(Chain.Ethereum, Chain.Ethereum))

    await expect(findSwapQuote({ ...evmSameChainCoins, amount: 1n })).rejects.toThrow(
      'Swap amount too small. Please increase the amount to proceed.'
    )
  })

  it('does not let a malformed provider amount hide a succeeding one', async () => {
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('not-a-number', 'kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => minimalNativeQuote(swapChain, '100'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('native' in quote.quote)) {
      throw new Error('Expected native quote')
    }
    expect(quote.quote.native.expected_amount_out).toBe('100')
  })

  it('surfaces a non-integer dstAmount drop via console.warn instead of dropping it silently (SDK-CORRECTNESS-04)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('1.5', 'kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => minimalNativeQuote(swapChain, '100'))

    await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('KyberSwap'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1.5'))

    warnSpy.mockRestore()
  })

  it('attempts SwapKit for newly enabled non-EVM source chains', async () => {
    vi.mocked(getSwapKitQuote).mockResolvedValue({
      dstAmount: '1000000000',
      provider: 'swapkit',
      tx: {
        transfer: {
          to: 'UQDeposit',
          amount: 100_000n,
        },
      },
    })

    const from = {
      chain: Chain.Bitcoin,
      address: 'bc1qsource',
      decimals: 8,
      ticker: 'BTC',
    }
    const to = {
      chain: Chain.Ton,
      address: 'UQDestination',
      decimals: 9,
      ticker: 'TON',
    }

    const quote = await findSwapQuote({
      from,
      to,
      amount: 100_000n,
    })

    expect(getSwapKitQuote).toHaveBeenCalledWith({
      from,
      to,
      amount: 100_000n,
      affiliateBps: 50,
    })
    expect(getNativeSwapQuote).not.toHaveBeenCalled()
    expect('general' in quote.quote).toBe(true)
  })

  it('breaks ties by earlier fetcher preference order', async () => {
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
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

  it('tie-break: SwapKit wins over 1inch on equal output by declared provider preference', async () => {
    // SwapKit now sits above the EVM aggregators in providerPreferenceOrder.
    // On an equal-output tie, it must win regardless of fetcher array order
    // (which is determined dynamically by shouldPreferGeneralSwap).
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getOneInchSwapQuote).mockResolvedValue(minimalGeneralQuote('500', '1inch'))
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('500', 'swapkit'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    expect('general' in quote.quote).toBe(true)
    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('swapkit')
  })

  it('selects Jupiter for same-chain Solana quotes when LiFi only beats it within the preference band', async () => {
    const solanaSameChainCoins = {
      from: {
        chain: Chain.Solana,
        address: '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB',
        decimals: 9,
        ticker: 'SOL',
      },
      to: {
        chain: Chain.Solana,
        address: '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB',
        id: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
        ticker: 'USDC',
      },
    } as const

    vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('1005000', 'li.fi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getJupiterSwapQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'jupiter'))

    const quote = await findSwapQuote({ ...solanaSameChainCoins, amount: 100000000n })

    expect('general' in quote.quote).toBe(true)
    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('jupiter')
    expect(getJupiterSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        affiliateBps: 50,
      })
    )
  })

  it('does not register Jupiter for cross-chain Solana routes', async () => {
    vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'li.fi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))

    await findSwapQuote({
      from: {
        chain: Chain.Solana,
        address: '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB',
        decimals: 9,
        ticker: 'SOL',
      },
      to: {
        chain: Chain.Ethereum,
        address: '0xsender',
        decimals: 18,
        ticker: 'ETH',
      },
      amount: 100000000n,
    })

    expect(getJupiterSwapQuote).not.toHaveBeenCalled()
  })

  it.each([
    ['Sui', Chain.Sui, 'sui-source', 9],
    ['Cardano', Chain.Cardano, 'addr1source', 6],
  ] as const)(
    'dispatches the SwapKit fetcher for a %s source (quote-eligibility only -- getSwapKitQuote itself still rejects it, see getSwapKitQuote.test.ts)',
    async (_label, chain, address, decimals) => {
      vi.mocked(getSwapKitQuote).mockRejectedValue(
        new Error(`SwapKit ${chain} source swaps are not yet supported for signing (quote-only for now).`)
      )
      vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))

      await expect(
        findSwapQuote({
          from: { chain, address, decimals, ticker: chain === Chain.Sui ? 'SUI' : 'ADA' },
          to: { chain: Chain.Ethereum, address: '0xdestination', decimals: 18, ticker: 'ETH' },
          amount: 1_000_000n,
        })
      ).rejects.toThrow()

      expect(getSwapKitQuote).toHaveBeenCalledWith(
        expect.objectContaining({ from: expect.objectContaining({ chain }) })
      )
    }
  )

  it('dispatches the MayaChain native fetcher for a Cardano source (live ADA.ADA pool)', async () => {
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => minimalNativeQuote(swapChain, '1000'))

    await findSwapQuote({
      from: { chain: Chain.Cardano, address: 'addr1source', decimals: 6, ticker: 'ADA' },
      to: { chain: Chain.Ethereum, address: '0xdestination', decimals: 18, ticker: 'ETH' },
      amount: 1_000_000n,
    })

    expect(getNativeSwapQuote).toHaveBeenCalledWith(
      expect.objectContaining({ swapChain: Chain.MayaChain, from: expect.objectContaining({ chain: Chain.Cardano }) })
    )
  })

  it('when all providers fail, reports every attempted provider', async () => {
    const mayaError = 'maya last error'
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('cowswap fail'))
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('first fail'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('second fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('third fail'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('fourth fail'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.THORChain) {
        throw new Error('thor fail')
      }
      throw new Error(mayaError)
    })

    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    ).rejects.toThrow(
      'No swap route found after trying CowSwap, KyberSwap, 1inch, LiFi, SwapKit, THORChain, MayaChain.'
    )
  })

  it('when all providers fail transiently (network/timeout/5xx), reports a transient error instead of a hard no-route', async () => {
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('fetch failed'))
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('ETIMEDOUT'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('socket hang up'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('HTTP 502 Bad Gateway'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('the operation was aborted'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('request timed out'))

    let thrown: Error | undefined
    try {
      await findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown!.message.toLowerCase()).not.toMatch(/\bno (?:swap )?routes? (?:found|available)\b/)
    expect(thrown!.message).toContain('transient network/timeout error')
    expect(thrown!.message).toContain('CowSwap, KyberSwap, 1inch, LiFi, SwapKit, THORChain, MayaChain')
  })

  it('classifies an HttpResponseError by its structured status even when the message body has no transient keyword (codex review follow-up)', async () => {
    // A provider's body text is opaque/oddly-worded ("Upstream unavailable") but the
    // HTTP status itself (503) is an unambiguous transient signal — HttpResponseError
    // carries `status` for exactly this reason (see its own doc comment: "so callers
    // can branch cleanly on it... instead of regex-matching the message string").
    const opaqueTransient = new HttpResponseError({
      message: 'Upstream unavailable',
      status: 503,
      statusText: 'Service Unavailable',
      url: 'https://example.test/quote',
      body: undefined,
    })
    vi.mocked(getCowSwapQuote).mockRejectedValue(opaqueTransient)
    vi.mocked(getKyberSwapQuote).mockRejectedValue(opaqueTransient)
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(opaqueTransient)
    vi.mocked(getLifiSwapQuote).mockRejectedValue(opaqueTransient)
    vi.mocked(getSwapKitQuote).mockRejectedValue(opaqueTransient)
    vi.mocked(getNativeSwapQuote).mockRejectedValue(opaqueTransient)

    let thrown: Error | undefined
    try {
      await findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown!.message).toContain('transient network/timeout error')
  })

  it('when only SOME providers fail transiently, still reports the definitive no-route message', async () => {
    // Mixed failure: one provider gave a genuine structural decline (no route), the
    // rest were transient. A single positive "no route" answer is authoritative —
    // it must NOT be masked by the other providers' unrelated network blips.
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('fetch failed'))
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('ETIMEDOUT'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('no routes found'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('HTTP 502 Bad Gateway'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('the operation was aborted'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('request timed out'))

    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    ).rejects.toThrow(
      'No swap route found after trying CowSwap, KyberSwap, 1inch, LiFi, SwapKit, THORChain, MayaChain.'
    )
  })

  it('surfaces a trading-halted message when a native protocol reports a halt', async () => {
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('cowswap fail'))
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('kyber fail'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('inch fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('lifi fail'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('swapkit fail'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(
      new Error(
        "failed to simulate swap: failed to simulate handler: trading is halted, can't process swap: invalid request"
      )
    )

    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    ).rejects.toThrow('temporarily unavailable — trading is halted on')
  })

  it('prefers a provider below-minimum over a native trading halt', async () => {
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('cowswap fail'))
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('kyber fail'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('inch fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('lifi fail'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('CHAINFLIP: Amount below minimum: 0.0003 BTC required'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('trading is halted'))

    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    ).rejects.toThrow('Amount below the minimum required by a swap provider.')
  })

  it('prefers a same-chain Solana Jupiter below-minimum message over LiFi', async () => {
    const solanaSameChainCoins = {
      from: {
        chain: Chain.Solana,
        address: '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB',
        decimals: 9,
        ticker: 'SOL',
      },
      to: {
        chain: Chain.Solana,
        address: '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB',
        id: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
        ticker: 'USDC',
      },
    } as const

    vi.mocked(getJupiterSwapQuote).mockRejectedValue(new Error('Jupiter minimum amount is 0.01 SOL'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('LiFi minimum amount is 0.02 SOL'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))

    await expect(findSwapQuote({ ...solanaSameChainCoins, amount: 1n })).rejects.toThrow(
      'Jupiter minimum amount is 0.01 SOL'
    )
  })

  it('omits noisy provider errors from the all-fail message', async () => {
    const longKyberError = `kyber ${'x'.repeat(220)}`

    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('cowswap fail'))
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error(longKyberError))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('inch fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('lifi fail'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('swapkit fail'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('native fail'))

    try {
      await findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
      throw new Error('Expected findSwapQuote to fail')
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error
      }

      expect(error.message).toBe(
        'No swap route found after trying CowSwap, KyberSwap, 1inch, LiFi, SwapKit, THORChain, MayaChain.'
      )
      expect(error.message).not.toContain(longKyberError)
      expect(error.message).not.toContain('inch fail')
    }
  })

  it('surfaces a below-minimum message from SwapKit providerErrors when all providers fail', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('kyber fail'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('inch fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('lifi fail'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('CHAINFLIP: Amount below minimum: 0.0003 BTC required'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('native fail'))

    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    ).rejects.toThrow('Amount below the minimum required by a swap provider.')
  })

  it('prefers dust-threshold message over below-minimum when both signals are present', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('kyber fail'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('inch fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('lifi fail'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('CHAINFLIP: Amount below minimum: 0.0003 BTC required'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.THORChain) {
        throw new Error('amount less than dust threshold')
      }
      throw new Error('maya fail')
    })

    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    ).rejects.toThrow('Swap amount too small. Please increase the amount to proceed.')
  })

  it('maps dust threshold on any provider to the user-facing message (Maya in this setup)', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('kyber fail'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('inch fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('lifi fail'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('swapkit fail'))
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

  it('maps dust threshold from an earlier provider (not only the last) to the user-facing message', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('quote below dust threshold'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('inch fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('lifi fail'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('swapkit fail'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('native fail'))

    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
      })
    ).rejects.toThrow('Swap amount too small. Please increase the amount to proceed.')
  })

  // --- Proactive THORChain minimum (#604) ---

  const nativeOnlyCoins = {
    from: {
      chain: Chain.Cosmos,
      address: 'cosmos1src',
      id: 'uatom',
      decimals: 6,
      ticker: 'ATOM',
    },
    to: {
      chain: Chain.Bitcoin,
      address: 'bc1qdst',
      decimals: 8,
      ticker: 'BTC',
    },
  } as const

  const minResult = (minAmountInBaseUnits: bigint, minAmountInHuman: string): NativeSwapMinAmountIn => ({
    swapChain: Chain.THORChain,
    minAmountInBaseUnits,
    minAmountInHuman,
    outboundFeeBaseUnit: '60000',
    binding: 'outbound',
  })

  it('surfaces the computed minimum when no provider returns a parseable below-min hint (#604)', async () => {
    // All providers reject with wordings the substring scan does NOT match —
    // exactly the THORChain "...amount is less than the minimum" case. The
    // proactive minimum is the authoritative signal in the all-fail path.
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('kyber fail'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('inch fail'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('lifi fail'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('SwapKit returned no eligible routes.'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('swap amount is less than the minimum'))
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(minResult(1_000_000n, '0.01'))

    await expect(findSwapQuote({ ...evmSameChainCoins, amount: 1n })).rejects.toThrow(
      'Amount is below the minimum for this swap. Minimum is ~0.01 SRC. Please increase the amount.'
    )
  })

  it('short-circuits before firing when a native protocol is the sole route family (#604)', async () => {
    // Cosmos -> Bitcoin: only THORChain can route (no EVM aggregator, no
    // SwapKit source). Below the minimum -> fail fast WITHOUT firing quotes.
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('should not be called'))
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(minResult(1_000_000n, '0.05'))

    await expect(findSwapQuote({ ...nativeOnlyCoins, amount: 1n })).rejects.toThrow(
      'Amount is below the minimum for this swap. Minimum is ~0.05 ATOM. Please increase the amount.'
    )
    expect(getNativeSwapQuote).not.toHaveBeenCalled()
  })

  it('surfaces a sole-route THORChain halt before the computed minimum (#696)', async () => {
    vi.mocked(getNativeSwapTradingHalt).mockResolvedValue({
      swapChain: Chain.THORChain,
      haltedChains: ['BTC'],
      reasons: ['BTC chain trading paused'],
    })
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(minResult(1_000_000n, '0.05'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('should not be called'))

    await expect(findSwapQuote({ ...nativeOnlyCoins, amount: 1n })).rejects.toThrow(
      'This swap route is temporarily unavailable — BTC chain trading paused. Please try again later.'
    )
    expect(getNativeSwapMinAmountIn).not.toHaveBeenCalled()
    expect(getNativeSwapQuote).not.toHaveBeenCalled()
  })

  it('does not block an above-minimum native-only swap', async () => {
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(minResult(1n, '0.0001'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) =>
      minimalNativeQuote(swapChain, '100000000')
    )

    const quote = await findSwapQuote({ ...nativeOnlyCoins, amount: 1_000_000n })

    expect('native' in quote.quote).toBe(true)
  })

  it('does NOT short-circuit multi-provider pairs — a routable aggregator still wins', async () => {
    // A high native minimum must not block a pair an aggregator can fulfill.
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(minResult(1_000_000n, '0.01'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('150', 'kyber'))

    const quote = await findSwapQuote({ ...evmSameChainCoins, amount: 1n })

    expect('general' in quote.quote).toBe(true)
  })

  it('does NOT short-circuit when MayaChain also routes — THOR is not the sole native family (#604)', async () => {
    // RUNE -> BTC routes on both THORChain and MayaChain with no aggregator. We
    // only compute THORChain's minimum, so eager-failing on it would wrongly
    // block an amount MayaChain might fill at a lower minimum. Quotes must fire.
    const thorAndMayaCoins = {
      from: { chain: Chain.THORChain, address: 'thor1src', decimals: 8, ticker: 'RUNE' },
      to: { chain: Chain.Bitcoin, address: 'bc1qdst', decimals: 8, ticker: 'BTC' },
    } as const
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(minResult(1_000_000n, '0.01'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) =>
      minimalNativeQuote(swapChain, '100000000')
    )

    const quote = await findSwapQuote({ ...thorAndMayaCoins, amount: 1n })

    expect(getNativeSwapQuote).toHaveBeenCalled()
    expect('native' in quote.quote).toBe(true)
  })

  it('preflights a THORChain inbound halt before requesting a native quote (#696)', async () => {
    vi.mocked(getNativeSwapTradingHalt).mockResolvedValue({
      swapChain: Chain.THORChain,
      haltedChains: ['BTC'],
      reasons: ['BTC chain trading paused'],
    })
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('should not be called'))

    await expect(findSwapQuote({ ...nativeOnlyCoins, amount: 1_000_000n })).rejects.toThrow(
      'This swap route is temporarily unavailable — BTC chain trading paused. Please try again later.'
    )
    expect(getNativeSwapQuote).not.toHaveBeenCalled()
  })

  it('does not let a halted THORChain native route hide a successful aggregator route (#696)', async () => {
    vi.mocked(getNativeSwapTradingHalt).mockImplementation(async ({ swapChain }) =>
      swapChain === Chain.THORChain
        ? {
            swapChain,
            haltedChains: ['ETH'],
            reasons: ['ETH chain trading paused'],
          }
        : null
    )
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('150', 'kyber'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.THORChain) {
        throw new Error('THORChain quote should have been preflight-blocked')
      }
      throw new Error('maya fail')
    })

    const quote = await findSwapQuote({ ...evmSameChainCoins, amount: 1n })

    expect('general' in quote.quote).toBe(true)
    if (!('general' in quote.quote)) {
      throw new Error('Expected aggregator quote')
    }
    expect(quote.quote.general.provider).toBe('kyber')
    expect(vi.mocked(getNativeSwapQuote).mock.calls.some(([input]) => input.swapChain === Chain.THORChain)).toBe(false)
  })
})

describe('findSwapQuote net-output provider selection (issues #605/#804)', () => {
  beforeEach(() => {
    vi.mocked(getCowSwapQuote).mockReset()
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('skip cowswap'))
    vi.mocked(getKyberSwapQuote).mockReset()
    vi.mocked(getOneInchSwapQuote).mockReset()
    vi.mocked(getLifiSwapQuote).mockReset()
    vi.mocked(getSwapKitQuote).mockReset()
    vi.mocked(getNativeSwapQuote).mockReset()
    vi.mocked(getNativeSwapTradingHalt).mockReset()
    vi.mocked(getNativeSwapMinAmountIn).mockReset()
    vi.mocked(getNativeSwapTradingHalt).mockResolvedValue(null)
    // Default: no proactive minimum signal unless a test opts in.
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(null)
  })

  // `evmSameChainCoins` has dst.decimals = 6. Aggregator dstAmount is already in
  // dst decimals. Native THORChain amounts are 8-decimal canonical → comparable
  // value = raw / 10^(8 - 6) = raw / 100. So to make THOR comparable-output ≈ X
  // (in 6 decimals), set native expected_amount_out = X * 100.

  it('same-chain ERC20 route picks SwapKit over THORChain when SwapKit is more than 50 bps better', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    // SwapKit: gross output 1_020_000 (in 6 dec).
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1020000', 'swapkit'))
    // THORChain native: comparable 1_000_000 (raw 100_000_000 in 8-dec). 1.96% lower -> outside band.
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.THORChain) {
        return minimalNativeQuote(swapChain, '100000000')
      }
      throw new Error('maya skip')
    })

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected SwapKit quote to win by rate outside the band')
    }
    expect(quote.quote.general.provider).toBe('swapkit')
  })

  it('outside band: the better-rate provider wins regardless of preference order', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    // Regression for reversing the paaao 2026-05-22 hard THOR priority directive:
    // under the old rule, THORChain won even when SwapKit was 10% better.
    // SwapKit: gross output 1_100_000 (10% higher than THORChain).
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1100000', 'swapkit'))
    // THORChain native: comparable 1_000_000. SwapKit is outside the 50 bps band, so rate wins.
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.THORChain) {
        return minimalNativeQuote(swapChain, '100000000')
      }
      throw new Error('maya skip')
    })

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected SwapKit quote to win by rate outside the band')
    }
    expect(quote.quote.general.provider).toBe('swapkit')
  })

  it('only SwapKit available → SwapKit wins (no native bias applies)', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('native unavailable'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected SwapKit quote')
    }
    expect(quote.quote.general.provider).toBe('swapkit')
  })

  it('only THORChain available → THORChain wins', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('swapkit unavailable'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.THORChain) {
        return minimalNativeQuote(swapChain, '100000000')
      }
      throw new Error('maya skip')
    })

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('native' in quote.quote)) {
      throw new Error('Expected THORChain native quote')
    }
    expect(quote.quote.native.swapChain).toBe(Chain.THORChain)
  })

  it('SwapKit ties THORChain on output -> THORChain wins by provider preference', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    // SwapKit: 1_000_000 (6-dec).
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'swapkit'))
    // THORChain native: 100_000_000 raw (8-dec) → 1_000_000 comparable.
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.THORChain) {
        return minimalNativeQuote(swapChain, '100000000')
      }
      throw new Error('maya skip')
    })

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    // On an exact tie, THORChain is within the band and outranks SwapKit.
    if (!('native' in quote.quote)) {
      throw new Error('Expected THORChain native quote to win on tie by provider preference')
    }
    expect(quote.quote.native.swapChain).toBe(Chain.THORChain)
  })

  it('when both THORChain and MayaChain succeed, returns the one with higher comparable output', async () => {
    // Ethereum is supported by both THORChain and MayaChain.
    // dst.decimals = 6 (evmSameChainCoins); native amounts are 8-dec canonical,
    // so comparable = raw / 100.
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    // THORChain: 100_000_000 raw → 1_000_000 comparable.
    // MayaChain:  120_000_000 raw → 1_200_000 comparable. Maya wins.
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.THORChain) {
        return minimalNativeQuote(swapChain, '100000000')
      }
      if (swapChain === Chain.MayaChain) {
        return minimalNativeQuote(swapChain, '120000000')
      }
      throw new Error(`unexpected swapChain: ${swapChain}`)
    })

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('native' in quote.quote)) {
      throw new Error('Expected a native quote')
    }
    expect(quote.quote.native.swapChain).toBe(Chain.MayaChain)
    expect(quote.quote.native.expected_amount_out).toBe('120000000')
  })

  it('near-tie: MayaChain wins when SwapKit is within the 50 bps band', async () => {
    // Use Arbitrum ↔ Arbitrum: Maya supports Arbitrum (per nativeSwapEnabledChainsRecord),
    // SwapKit supports Arbitrum as well. THORChain does NOT support Arbitrum.
    const arbCoins = {
      from: {
        chain: Chain.Arbitrum,
        address: '0xsender',
        id: '0xsrc',
        decimals: 18,
        ticker: 'SRC',
      },
      to: {
        chain: Chain.Arbitrum,
        address: '0xsender',
        id: '0xdst',
        decimals: 6,
        ticker: 'DST',
      },
    } as const

    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    // SwapKit better by 0.5%, within the 50 bps band.
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1005000', 'swapkit'))
    // Maya native: 8-dec canonical → 1_000_000 comparable.
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => {
      if (swapChain === Chain.MayaChain) {
        return minimalNativeQuote(swapChain, '100000000')
      }
      throw new Error('thor skip')
    })

    const quote = await findSwapQuote({
      ...arbCoins,
      amount: 1n,
    })

    if (!('native' in quote.quote)) {
      throw new Error('Expected Maya native quote to win by provider preference on Arbitrum')
    }
    expect(quote.quote.native.swapChain).toBe(Chain.MayaChain)
  })

  it('near-tie: SwapKit beats LiFi when within the 50 bps band', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    // LiFi has the best output, but SwapKit is only 0.5% lower and ranks higher.
    vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('1005000', 'li.fi'))
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'swapkit'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('swapkit')
  })

  it('outside 50 bps band: LiFi beats preferred SwapKit on net output', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('1006000', 'li.fi'))
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'swapkit'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('li.fi')
  })

  it('does not double-subtract 1inch affiliate fee because 1inch dstAmount is already net', async () => {
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'kyber'))
    // The 1inch API already lowers dstAmount when the affiliate fee is supplied.
    // If we subtracted the default 50 bps again, this would fall back into the
    // preference band and incorrectly pick Kyber.
    vi.mocked(getOneInchSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1006000', '1inch', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          affiliateFee: {
            chain: Chain.Ethereum,
            id: '0xdst',
            decimals: 6,
            amount: 5030n,
          },
        },
      })
    )

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('1inch')
  })

  it('does not double-subtract Kyber affiliate fee because Kyber dstAmount is already net', async () => {
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', 'kyber', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          affiliateFee: {
            chain: Chain.Ethereum,
            id: '0xdst',
            decimals: 6,
            amount: 5025n,
          },
        },
      })
    )
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('994000', 'swapkit'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('kyber')
  })

  it('does not double-subtract LiFi affiliate fee because LiFi dstAmount is already net', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getLifiSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1006000', 'li.fi', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          affiliateFee: {
            chain: Chain.Ethereum,
            id: '0xdst',
            decimals: 6,
            amount: 5030n,
          },
        },
      })
    )
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'swapkit'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('li.fi')
  })

  it('does not subtract a LiFi source-token affiliate fee from destination output', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getLifiSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1006000', 'li.fi', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          affiliateFee: {
            chain: Chain.Ethereum,
            id: '0xsrc',
            decimals: 18,
            amount: 1_000_000_000_000_000n,
          },
        },
      })
    )
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'swapkit'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('li.fi')
  })

  it('does not let same-chain EVM gas override provider preference', async () => {
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', 'kyber', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          gasLimit: 250_000n,
        },
      })
    )
    vi.mocked(getOneInchSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', '1inch', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          gasLimit: 100_000n,
        },
      })
    )

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('kyber')
  })

  it('lets later higher-preference SwapKit beat lower-gas 1inch inside the band', async () => {
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getOneInchSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', '1inch', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          gasLimit: 100_000n,
        },
      })
    )
    vi.mocked(getSwapKitQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', 'swapkit', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          gasLimit: 250_000n,
        },
      })
    )

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('swapkit')
  })

  it('keeps CowSwap first on equal same-chain EVM output', async () => {
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getCowSwapQuote).mockResolvedValue(minimalCowSwapQuote('1000000'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', 'kyber', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          gasLimit: 100_000n,
        },
      })
    )
    vi.mocked(getOneInchSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', '1inch', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          gasLimit: 90_000n,
        },
      })
    )
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'swapkit'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('cowswap')
  })

  it('excludeProviders: ["CowSwap"] falls through to the next-best BUILDABLE provider instead of CowSwap, even on an equal/winning output', async () => {
    // Identical fixture to "keeps CowSwap first on equal same-chain EVM
    // output" above -- CowSwap would otherwise win this tie. A consumer that
    // can't build/sign CowSwap's cowswap_order shape (e.g. agent-backend-ts,
    // which has no EIP-712 order-signing flow wired) opts out via
    // excludeProviders so the swap actually falls to a provider it CAN build.
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getCowSwapQuote).mockResolvedValue(minimalCowSwapQuote('1000000'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', 'kyber', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          gasLimit: 100_000n,
        },
      })
    )
    vi.mocked(getOneInchSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', '1inch', {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0x',
          value: '0',
          gasLimit: 90_000n,
        },
      })
    )
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'swapkit'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
      excludeProviders: ['CowSwap'],
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    // getCowSwapQuote must never even be CALLED -- excluded before the fetch,
    // not merely out-ranked after a wasted network round-trip.
    expect(getCowSwapQuote).not.toHaveBeenCalled()
    expect(quote.quote.general.provider).not.toBe('cowswap')
  })

  it('excludeProviders accepts returned quote provider ids so ["cowswap"] also excludes CowSwap', async () => {
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getCowSwapQuote).mockResolvedValue(minimalCowSwapQuote('1000000'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('900000', 'kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
      excludeProviders: ['cowswap'],
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(getCowSwapQuote).not.toHaveBeenCalled()
    expect(quote.quote.general.provider).toBe('kyber')
  })

  it('excludeProviders fails closed when every eligible provider is excluded', async () => {
    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
        excludeProviders: ['CowSwap', 'KyberSwap', '1inch', 'LiFi', 'SwapKit', 'THORChain', 'MayaChain'],
      })
    ).rejects.toThrow('No swap routes found.')

    expect(getCowSwapQuote).not.toHaveBeenCalled()
    expect(getKyberSwapQuote).not.toHaveBeenCalled()
    expect(getOneInchSwapQuote).not.toHaveBeenCalled()
    expect(getLifiSwapQuote).not.toHaveBeenCalled()
    expect(getSwapKitQuote).not.toHaveBeenCalled()
    expect(getNativeSwapQuote).not.toHaveBeenCalled()
  })

  it('excludeProviders rejects unknown tokens instead of silently failing open', async () => {
    await expect(
      findSwapQuote({
        ...evmSameChainCoins,
        amount: 1n,
        excludeProviders: ['not-a-provider' as never],
      })
    ).rejects.toThrow('Unknown swap quote provider exclusion: not-a-provider')

    expect(getCowSwapQuote).not.toHaveBeenCalled()
    expect(getKyberSwapQuote).not.toHaveBeenCalled()
    expect(getNativeSwapQuote).not.toHaveBeenCalled()
  })

  it('excludeProviders is additive/opt-in: omitting it keeps CowSwap eligible (default behavior for every other consumer is unchanged)', async () => {
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
    vi.mocked(getCowSwapQuote).mockResolvedValue(minimalCowSwapQuote('1000000'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', 'kyber', {
        evm: { from: '0xsender', to: '0xrouter', data: '0x', value: '0', gasLimit: 100_000n },
      })
    )
    vi.mocked(getOneInchSwapQuote).mockResolvedValue(
      minimalGeneralQuote('1000000', '1inch', {
        evm: { from: '0xsender', to: '0xrouter', data: '0x', value: '0', gasLimit: 90_000n },
      })
    )
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'swapkit'))

    const quote = await findSwapQuote({
      ...evmSameChainCoins,
      amount: 1n,
      // excludeProviders omitted entirely.
    })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('cowswap')
  })
})

describe('findSwapQuote per-fetcher timeout guard (issue #412)', () => {
  beforeEach(() => {
    vi.mocked(getCowSwapQuote).mockReset()
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('skip cowswap'))
    vi.mocked(getKyberSwapQuote).mockReset()
    vi.mocked(getOneInchSwapQuote).mockReset()
    vi.mocked(getLifiSwapQuote).mockReset()
    vi.mocked(getSwapKitQuote).mockReset()
    vi.mocked(getNativeSwapQuote).mockReset()
    vi.mocked(getNativeSwapMinAmountIn).mockReset()
    // Default: no proactive minimum signal unless a test opts in.
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(null)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not stall when one provider hangs - the other providers still resolve', async () => {
    // KyberSwap hangs forever; the other providers resolve quickly.
    vi.mocked(getKyberSwapQuote).mockReturnValue(new Promise(() => undefined))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('native unavailable'))

    const resultPromise = findSwapQuote({ ...evmSameChainCoins, amount: 1n })

    // Advance past the 30s per-fetcher timeout so the hanging provider is rejected.
    await vi.runAllTimersAsync()

    const quote = await resultPromise

    expect('general' in quote.quote).toBe(true)
    if (!('general' in quote.quote)) {
      throw new Error('Expected SwapKit quote')
    }
    expect(quote.quote.general.provider).toBe('swapkit')
  })

  it('rejects with no-route error when every provider hangs', async () => {
    vi.mocked(getKyberSwapQuote).mockReturnValue(new Promise(() => undefined))
    vi.mocked(getOneInchSwapQuote).mockReturnValue(new Promise(() => undefined))
    vi.mocked(getLifiSwapQuote).mockReturnValue(new Promise(() => undefined))
    vi.mocked(getSwapKitQuote).mockReturnValue(new Promise(() => undefined))
    vi.mocked(getNativeSwapQuote).mockReturnValue(new Promise(() => undefined))

    const resultPromise = findSwapQuote({ ...evmSameChainCoins, amount: 1n })
    // Register the rejection handler BEFORE advancing timers - avoids an
    // unhandled-rejection when the promise rejects mid-tick after runAllTimersAsync.
    const assertion = expect(resultPromise).rejects.toThrow(
      'No swap route found after trying CowSwap, KyberSwap, 1inch, LiFi, SwapKit, THORChain, MayaChain.'
    )
    await vi.runAllTimersAsync()
    await assertion
  })
})
