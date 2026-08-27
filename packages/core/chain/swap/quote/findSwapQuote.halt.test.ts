import { Chain } from '@vultisig/core-chain/Chain'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { getNativeSwapTradingHalt } from '@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt'
import { getNativeSwapMinAmountIn } from '@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn'
import { SwapError, SwapErrorCode } from '@vultisig/core-chain/swap/SwapError'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { evmToSolanaCoins, minimalGeneralQuote } from './__tests__/swapQuoteFixtures'
import { findSwapQuotes } from './findSwapQuote'

vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt', () => ({
  getNativeSwapTradingHalt: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({ getNativeSwapQuote: vi.fn() }))
vi.mock('@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote', () => ({ getLifiSwapQuote: vi.fn() }))
vi.mock('@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote', () => ({ getSwapKitQuote: vi.fn() }))

const timeoutError = () => new Error('swap quote fetch timed out after 30000ms')
const noRouteError = () => new Error('no swap routes found for this pair')

const haltThorchain = () =>
  vi.mocked(getNativeSwapTradingHalt).mockResolvedValue({
    swapChain: Chain.THORChain,
    haltedChains: ['ETH'],
    reasons: ['ETH chain trading paused'],
  })

const quoteEthToSol = () => findSwapQuotes({ ...evmToSolanaCoins, amount: 10n ** 18n })

describe('findSwapQuotes with a halted native protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // ETH -> SOL registers THORChain, LiFi and SwapKit; each test opts providers in.
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('native unavailable'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(noRouteError())
    vi.mocked(getSwapKitQuote).mockRejectedValue(noRouteError())
    vi.mocked(getNativeSwapTradingHalt).mockResolvedValue(null)
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(null)
  })

  it('returns the aggregator quote when THORChain is halted and LiFi answers', async () => {
    haltThorchain()
    vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('500', 'li.fi'))

    const { best } = await quoteEthToSol()

    expect('general' in best.quote && best.quote.general.provider).toBe('li.fi')
    expect(getLifiSwapQuote).toHaveBeenCalledTimes(1)
  })

  it('retries a transiently-failed aggregator once and returns its quote instead of a halt', async () => {
    haltThorchain()
    vi.mocked(getLifiSwapQuote)
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValue(minimalGeneralQuote('500', 'li.fi'))

    const { best } = await quoteEthToSol()

    expect('general' in best.quote && best.quote.general.provider).toBe('li.fi')
    expect(getLifiSwapQuote).toHaveBeenCalledTimes(2)
    // The halt belongs to THORChain — re-asking it would only re-confirm the halt.
    expect(getNativeSwapQuote).toHaveBeenCalledTimes(0)
    expect(getNativeSwapTradingHalt).toHaveBeenCalledTimes(1)
  })

  it('retries every transiently-failed aggregator, not just the first', async () => {
    haltThorchain()
    vi.mocked(getLifiSwapQuote).mockRejectedValue(timeoutError())
    vi.mocked(getSwapKitQuote)
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue(minimalGeneralQuote('700', 'swapkit'))

    const { best } = await quoteEthToSol()

    expect('general' in best.quote && best.quote.general.provider).toBe('swapkit')
    expect(getLifiSwapQuote).toHaveBeenCalledTimes(2)
    expect(getSwapKitQuote).toHaveBeenCalledTimes(2)
  })

  it('reports the transient failure rather than a halt when the retry also fails', async () => {
    haltThorchain()
    vi.mocked(getLifiSwapQuote).mockRejectedValue(timeoutError())

    const error = await quoteEthToSol().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SwapError)
    expect((error as SwapError).code).toBe(SwapErrorCode.AllProvidersFailed)
    expect((error as SwapError).message).toContain('LiFi')
    expect((error as SwapError).message).toContain('retry the same swap shortly')
    expect(getLifiSwapQuote).toHaveBeenCalledTimes(2)
  })

  it('still throws TradingHalted when every aggregator structurally declined the pair', async () => {
    haltThorchain()

    const error = await quoteEthToSol().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SwapError)
    expect((error as SwapError).code).toBe(SwapErrorCode.TradingHalted)
    // A structural "no route" is a genuine answer, so nothing is retried.
    expect(getLifiSwapQuote).toHaveBeenCalledTimes(1)
    expect(getSwapKitQuote).toHaveBeenCalledTimes(1)
  })

  it('still throws TradingHalted when THORChain is the only route for the pair', async () => {
    haltThorchain()

    const error = await findSwapQuotes({
      ...evmToSolanaCoins,
      amount: 10n ** 18n,
      excludeProviders: ['li.fi', 'swapkit'],
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SwapError)
    expect((error as SwapError).code).toBe(SwapErrorCode.TradingHalted)
    expect(getLifiSwapQuote).not.toHaveBeenCalled()
    expect(getSwapKitQuote).not.toHaveBeenCalled()
  })

  it('does not retry transient aggregator failures when no native protocol is halted', async () => {
    vi.mocked(getLifiSwapQuote).mockRejectedValue(timeoutError())
    vi.mocked(getSwapKitQuote).mockRejectedValue(timeoutError())
    vi.mocked(getNativeSwapQuote).mockRejectedValue(timeoutError())

    const error = await quoteEthToSol().catch((e: unknown) => e)

    expect((error as SwapError).code).toBe(SwapErrorCode.AllProvidersFailed)
    expect(getLifiSwapQuote).toHaveBeenCalledTimes(1)
    expect(getSwapKitQuote).toHaveBeenCalledTimes(1)
  })
})
