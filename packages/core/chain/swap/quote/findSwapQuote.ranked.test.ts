import { getCowSwapQuote } from '@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote'
import { getJupiterSwapQuote } from '@vultisig/core-chain/swap/general/jupiter/api/getJupiterSwapQuote'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { getOneInchSwapQuote } from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { getNativeSwapTradingHalt } from '@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt'
import { getNativeSwapMinAmountIn } from '@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { evmSameChainCoins, minimalGeneralQuote, minimalNativeQuote } from './__tests__/swapQuoteFixtures'
import { findSwapQuote, findSwapQuotes } from './findSwapQuote'
import { getSwapQuoteSafetyFingerprint } from './getSwapQuoteSafetyFingerprint'

vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt', () => ({
  getNativeSwapTradingHalt: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({ getNativeSwapQuote: vi.fn() }))
vi.mock('@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote', () => ({ getSwapKitQuote: vi.fn() }))
vi.mock('@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote', () => ({ getOneInchSwapQuote: vi.fn() }))
vi.mock('@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote', () => ({ getLifiSwapQuote: vi.fn() }))
vi.mock('@vultisig/core-chain/swap/general/kyber/api/quote', () => ({ getKyberSwapQuote: vi.fn() }))
vi.mock('@vultisig/core-chain/swap/general/jupiter/api/getJupiterSwapQuote', () => ({ getJupiterSwapQuote: vi.fn() }))
vi.mock('@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote', () => ({ getCowSwapQuote: vi.fn() }))

describe('findSwapQuotes ranked candidate set', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: every provider declines; each test opts specific providers in.
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('skip cowswap'))
    vi.mocked(getJupiterSwapQuote).mockRejectedValue(new Error('skip jupiter'))
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('native unavailable'))
    vi.mocked(getNativeSwapTradingHalt).mockResolvedValue(null)
    vi.mocked(getNativeSwapMinAmountIn).mockResolvedValue(null)
  })

  it('returns every fulfilled quote sorted best→worst by comparable net output', async () => {
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('300', 'kyber'))
    vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('200', 'li.fi'))
    vi.mocked(getOneInchSwapQuote).mockResolvedValue(minimalGeneralQuote('100', '1inch'))

    const { best, ranked } = await findSwapQuotes({ ...evmSameChainCoins, amount: 1n })

    expect(ranked.map(candidate => candidate.providerName)).toEqual(['KyberSwap', 'LiFi', '1inch'])
    expect(ranked.map(candidate => candidate.outputAmount)).toEqual([300n, 200n, 100n])
    // Outputs are far apart (outside the preference band), so the auto-selected
    // winner is the rate-top — the same object as the ranked head.
    expect(best).toBe(ranked[0].quote)
  })

  it('normalizes native and general outputs to destination decimals before ranking', async () => {
    // Destination has 6 decimals; native THOR/Maya amounts are 8-decimal
    // canonical → 20_000 rebases to 200, beating Kyber's 150.
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('150', 'kyber'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => minimalNativeQuote(swapChain, '20000'))

    const { ranked } = await findSwapQuotes({ ...evmSameChainCoins, amount: 1n })

    expect(ranked[0].providerName).toBe('THORChain')
    expect(ranked[0].outputAmount).toBe(200n)
    expect(ranked[ranked.length - 1].providerName).toBe('KyberSwap')
    expect(ranked[ranked.length - 1].outputAmount).toBe(150n)
  })

  it('breaks exact-output ties by provider preference order', async () => {
    vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('500000', 'li.fi'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('500000', 'kyber'))

    const { ranked } = await findSwapQuotes({ ...evmSameChainCoins, amount: 1n })

    expect(ranked.map(candidate => candidate.providerName)).toEqual(['KyberSwap', 'LiFi'])
  })

  it('keeps the band winner as best while ranking the higher-output provider first', async () => {
    // LiFi's output is higher, but SwapKit is within the 0.5% preference band
    // and ranks earlier in providerPreferenceOrder — so SwapKit wins selection
    // while the ranked list still leads with the raw rate-top.
    vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'li.fi'))
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('999000', 'swapkit'))

    const { best, ranked } = await findSwapQuotes({ ...evmSameChainCoins, amount: 1n })

    if (!('general' in best.quote)) {
      throw new Error('Expected general quote')
    }
    expect(best.quote.general.provider).toBe('swapkit')
    expect(ranked[0].providerName).toBe('LiFi')
    expect(ranked.some(candidate => candidate.quote === best)).toBe(true)
  })

  it('binds safety metadata on every ranked candidate, not only the winner', async () => {
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('300', 'kyber'))
    vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('200', 'li.fi'))

    const requestedAmount = 123n
    const { ranked } = await findSwapQuotes({ ...evmSameChainCoins, amount: requestedAmount })

    expect(ranked).toHaveLength(2)
    for (const { quote } of ranked) {
      expect(quote.requestedAmount).toBe(requestedAmount)
      expect(quote.expiresAt).toBeGreaterThan(Date.now())
      expect(quote.safetyFingerprint).toBe(
        getSwapQuoteSafetyFingerprint({
          ...evmSameChainCoins,
          requestedAmount,
          expiresAt: quote.expiresAt,
          quote: quote.quote,
        })
      )
    }
  })

  it('drops a quote with an unparseable output amount from the ranked list', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('1.5', 'kyber'))
      vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('200', 'li.fi'))

      const { best, ranked } = await findSwapQuotes({ ...evmSameChainCoins, amount: 1n })

      expect(ranked.map(candidate => candidate.providerName)).toEqual(['LiFi'])
      expect(best).toBe(ranked[0].quote)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('exposes the ranked outputAmount on the returned quote itself (architecture#2081)', async () => {
    // Regression for architecture#2081: consumers reading only the bound quote
    // (not `findSwapQuotes`' separate `ranked` array) used to have no way to
    // learn the comparable destination-unit output without re-deriving the
    // native-precision conversion themselves.
    vi.mocked(getKyberSwapQuote).mockResolvedValue(minimalGeneralQuote('300', 'kyber'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) => minimalNativeQuote(swapChain, '20000'))

    const { best, ranked } = await findSwapQuotes({ ...evmSameChainCoins, amount: 1n })

    const bestCandidate = ranked.find(candidate => candidate.quote === best)
    expect(bestCandidate).toBeDefined()
    expect(best.comparableOutputAmount).toBe(bestCandidate!.outputAmount)
    for (const candidate of ranked) {
      expect(candidate.quote.comparableOutputAmount).toBe(candidate.outputAmount)
    }
  })

  it('resolves findSwapQuote to the same provider as the best candidate', async () => {
    vi.mocked(getLifiSwapQuote).mockResolvedValue(minimalGeneralQuote('1000000', 'li.fi'))
    vi.mocked(getSwapKitQuote).mockResolvedValue(minimalGeneralQuote('999000', 'swapkit'))

    const quote = await findSwapQuote({ ...evmSameChainCoins, amount: 1n })

    if (!('general' in quote.quote)) {
      throw new Error('Expected general quote')
    }
    expect(quote.quote.general.provider).toBe('swapkit')
  })

  it('rejects with the same classified error when no provider yields a quote', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(findSwapQuotes({ ...evmSameChainCoins, amount: 1n })).rejects.toThrow(
        /No swap route found after trying/
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})
