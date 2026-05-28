import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getSwapAffiliateBps, VultDiscountTier } from '@vultisig/core-chain/swap/affiliate'
import { SwapDiscount } from '@vultisig/core-chain/swap/discount/SwapDiscount'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { kyberSwapEnabledChains } from '@vultisig/core-chain/swap/general/kyber/chains'
import { KyberSwapBaseAffiliateConfig } from '@vultisig/core-chain/swap/general/kyber/config'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { lifiSwapEnabledChains } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import {
  getOneInchSwapQuote,
  OneInchAffiliateConfig,
} from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import { oneInchSwapEnabledChains } from '@vultisig/core-chain/swap/general/oneInch/OneInchSwapEnabledChains'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import {
  swapKitEnabledChains,
  swapKitSourceChains,
} from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import { NativeSwapAffiliateConfig } from '@vultisig/core-chain/swap/native/api/affiliate'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { nativeSwapChains, nativeSwapEnabledChainsRecord } from '@vultisig/core-chain/swap/native/NativeSwapChain'
import { getNativeSwapDecimals } from '@vultisig/core-chain/swap/native/utils/getNativeSwapDecimals'
import { NoSwapRoutesError } from '@vultisig/core-chain/swap/NoSwapRoutesError'
import { isEmpty } from '@vultisig/lib-utils/array/isEmpty'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { bigIntToNumber } from '@vultisig/lib-utils/bigint/bigIntToNumber'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { pick } from '@vultisig/lib-utils/record/pick'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

import { SwapQuote } from './SwapQuote'

/** Optional per-aggregator affiliate overrides. When absent each aggregator
 * falls back to its own vultisig-0 default — no behavior change for existing
 * callers. This TYPE is stable SDK API. Tenant consumers (e.g. Station) supply
 * their own concrete config instances and pass them here; those instances live
 * in the consumer package, not in the SDK. */
export type SwapAffiliateConfig = {
  native?: NativeSwapAffiliateConfig
  oneInch?: OneInchAffiliateConfig
  kyber?: KyberSwapBaseAffiliateConfig
}

export type FindSwapQuoteInput = Record<TransferDirection, AccountCoin> & {
  amount: bigint
  referral?: string
  vultDiscountTier?: VultDiscountTier | null
  affiliateConfig?: SwapAffiliateConfig
}

type SwapQuoteProviderName = 'KyberSwap' | '1inch' | 'LiFi' | 'SwapKit' | 'THORChain' | 'MayaChain'

type SwapQuoteFetcher = {
  providerName: SwapQuoteProviderName
  fetch: () => Promise<SwapQuote>
}

type RankedSwapQuote = {
  quote: SwapQuote
  outputAmount: bigint
  providerName: SwapQuoteProviderName
}

/**
 * Hard native priority: when any direct THORChain or MayaChain route is available,
 * it is always preferred over any aggregator (SwapKit, LiFi, etc.) regardless of
 * gross output. When both THOR and Maya succeed, the one with the higher comparable
 * output wins; among aggregator-only results the normal output ranking applies.
 *
 * Rationale (paaao, 2026-05-22): for L1 swaps that native protocols serve directly,
 * the protocol-aligned route is always preferred. Direct routes capture full
 * vultisig affiliate revenue and avoid the aggregator fee skim; the protocol is
 * the moat. Mirrors the priority-first-success pattern in vultisig-ios's
 * `SwapService.fetchQuote` + `Coin+Swaps.swapProviders`.
 */

/**
 * Native swap providers — direct on-chain protocols (no aggregator layer).
 *
 * Adding a new native protocol (e.g. Chainflip-direct in the future) requires:
 *   1. Adding its name to `SwapQuoteProviderName` above
 *   2. Adding it here so `isNativeProvider` recognises it for hard-priority
 *      selection in `selectBestEligibleQuote`
 *   3. Wiring its fetcher into `getNativeFetchers`
 *
 * The `satisfies` clause gives compile-time safety against typos, but the
 * semantic mapping (which providers count as "native") still lives in this
 * file and must be kept aligned with the protocol's actual integration mode.
 */
const nativeProviderNames = ['THORChain', 'MayaChain'] as const satisfies readonly SwapQuoteProviderName[]

type NativeProviderName = (typeof nativeProviderNames)[number]

const nativeProviderNamesSet = new Set<SwapQuoteProviderName>(nativeProviderNames)

const isNativeProvider = (name: SwapQuoteProviderName): name is NativeProviderName => nativeProviderNamesSet.has(name)

const QUOTE_FETCH_TIMEOUT_MS = 30_000

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`swap quote fetch timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId)
  })
}

/**
 * Declared preference order for AGGREGATOR ties — when two aggregators return
 * identical `outputAmount`, the earlier entry wins. This makes the tie-break
 * explicit (the previous implementation tied via `fetchers[]` array index,
 * which was determined dynamically by `shouldPreferGeneralSwap` and therefore
 * harder to reason about). Native providers (THORChain/MayaChain) bypass this
 * because they have hard priority over aggregators regardless of output.
 *
 * Order rationale: KyberSwap and 1inch typically surface the best on-chain
 * liquidity for EVM-only swaps; LiFi covers the broader cross-chain matrix;
 * SwapKit is the catch-all fallback. Adjust as data changes.
 *
 * @internal Exported for unit-test introspection only.
 */
export const aggregatorPreferenceOrder: readonly SwapQuoteProviderName[] = [
  'KyberSwap',
  '1inch',
  'LiFi',
  'SwapKit',
] as const

const aggregatorPreferenceIndex = new Map<SwapQuoteProviderName, number>(
  aggregatorPreferenceOrder.map((name, idx) => [name, idx])
)

const getAggregatorPreferenceRank = (name: SwapQuoteProviderName): number =>
  aggregatorPreferenceIndex.get(name) ?? Number.POSITIVE_INFINITY

/** Re-base an integer amount from `fromDecimals` fixed-point to `toDecimals`. */
function rebaseDecimals(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) {
    return value
  }
  if (toDecimals > fromDecimals) {
    return value * 10n ** BigInt(toDecimals - fromDecimals)
  }
  return value / 10n ** BigInt(fromDecimals - toDecimals)
}

/**
 * Comparable destination amount in the destination token's smallest units (same
 * scale as `general.dstAmount`).
 *
 * Native swap APIs report `expected_amount_out` in chain-specific precision
 * (`getNativeSwapDecimals`); aggregators use the destination token's decimals.
 * Without re-basing, THORChain (8-decimal canonical) and Kyber (token decimals)
 * are not comparable as raw bigints.
 *
 * TODO(#353 follow-up): subtract route-specific gas / outbound fees for true net
 * output; today this ranks gross destination amount after decimal alignment only.
 */
function getComparableOutputAmount(q: SwapQuote, to: AccountCoin): bigint {
  if ('native' in q.quote) {
    const nativePrecision = getNativeSwapDecimals(to)
    const raw = BigInt(q.quote.native.expected_amount_out)
    return rebaseDecimals(raw, nativePrecision, to.decimals)
  }
  return BigInt(q.quote.general.dstAmount)
}

function selectBestEligibleQuote(settled: PromiseSettledResult<RankedSwapQuote>[]): SwapQuote | null {
  let bestNative: RankedSwapQuote | null = null
  let bestAggregator: RankedSwapQuote | null = null
  let bestAggregatorPreferenceRank = Number.POSITIVE_INFINITY

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status !== 'fulfilled') {
      continue
    }
    const candidate = result.value

    if (isNativeProvider(candidate.providerName)) {
      // Among natives (THOR + Maya), prefer higher output.
      if (bestNative === null || candidate.outputAmount > bestNative.outputAmount) {
        bestNative = candidate
      }
    } else {
      // Tie-break by declared aggregator preference (lower rank wins). This
      // replaces the previous index-based tie-break, which was determined
      // dynamically by `shouldPreferGeneralSwap` and therefore harder to
      // reason about. The declared order lives in `aggregatorPreferenceOrder`
      // above. (#521 r3 — NeO should-fix.)
      const candidateRank = getAggregatorPreferenceRank(candidate.providerName)
      if (
        bestAggregator === null ||
        candidate.outputAmount > bestAggregator.outputAmount ||
        (candidate.outputAmount === bestAggregator.outputAmount && candidateRank < bestAggregatorPreferenceRank)
      ) {
        bestAggregator = candidate
        bestAggregatorPreferenceRank = candidateRank
      }
    }
  }

  // Hard THORChain/Maya priority: if any native route exists, always prefer it
  // over any aggregator route. Mirrors vultisig-ios's priority-first-success
  // pattern. No output comparison between native and aggregator.
  return (bestNative ?? bestAggregator)?.quote ?? null
}

export const findSwapQuote = async ({
  from,
  to,
  amount,
  referral,
  vultDiscountTier,
  affiliateConfig,
}: FindSwapQuoteInput): Promise<SwapQuote> => {
  // Runtime guard: THORName affiliateFeeAddress must be lowercase.
  // THORChain memo parsing is case-sensitive — passing 'STVS' instead of 'stvs'
  // silently routes affiliate fees to the vultisig-0 default instead of the
  // intended recipient. Fail loudly at call-site rather than silently misbehave.
  const nativeAffiliateFeeAddress = affiliateConfig?.native?.affiliateFeeAddress
  if (
    nativeAffiliateFeeAddress !== undefined &&
    nativeAffiliateFeeAddress !== nativeAffiliateFeeAddress.toLowerCase()
  ) {
    throw new Error(
      `THORName affiliateFeeAddress must be lowercase. THORChain memo parsing is case-sensitive. Using "${nativeAffiliateFeeAddress}" will silently break affiliate fee routing.`
    )
  }

  const affiliateBps = getSwapAffiliateBps(vultDiscountTier ?? null)

  const vultDiscount: SwapDiscount[] = vultDiscountTier ? [{ vult: { tier: vultDiscountTier } }] : []

  const referralDiscount: SwapDiscount[] = referral ? [{ referral: {} }] : []

  const involvedChains = [from.chain, to.chain]

  const matchingSwapChains = nativeSwapChains.filter(swapChain =>
    involvedChains.every(chain => isOneOf(chain, nativeSwapEnabledChainsRecord[swapChain]))
  )

  const getNativeFetchers = (): SwapQuoteFetcher[] =>
    matchingSwapChains.map(swapChain => ({
      providerName: swapChain === Chain.THORChain ? 'THORChain' : 'MayaChain',
      fetch: async (): Promise<SwapQuote> => {
        const fromDecimals = from.decimals
        const amountNumber = bigIntToNumber(amount, fromDecimals)
        const native = await getNativeSwapQuote({
          swapChain,
          destination: to.address,
          from,
          to,
          amount: amountNumber,
          referral,
          affiliateBps,
          nativeAffiliateConfig: affiliateConfig?.native,
        })

        return {
          quote: { native },
          discounts: swapChain === Chain.THORChain ? [...vultDiscount, ...referralDiscount] : vultDiscount,
        }
      },
    }))

  const getGeneralFetchers = (): SwapQuoteFetcher[] => {
    const result: SwapQuoteFetcher[] = []

    const fromChain = from.chain
    const toChain = to.chain
    const chainAmount = amount

    if (
      isOneOf(fromChain, kyberSwapEnabledChains) &&
      isOneOf(toChain, kyberSwapEnabledChains) &&
      fromChain === toChain
    ) {
      result.push({
        providerName: 'KyberSwap',
        fetch: async (): Promise<SwapQuote> => {
          const general = await getKyberSwapQuote({
            from: {
              ...from,
              chain: fromChain,
            },
            to: {
              ...to,
              chain: toChain,
            },
            amount: chainAmount,
            affiliateBps,
            kyberConfig: affiliateConfig?.kyber,
          })

          return { quote: { general }, discounts: vultDiscount }
        },
      })
    }

    if (isOneOf(from.chain, oneInchSwapEnabledChains) && from.chain === to.chain) {
      result.push({
        providerName: '1inch',
        fetch: async (): Promise<SwapQuote> => {
          const general = await getOneInchSwapQuote({
            account: pick(from, ['address', 'chain']),
            fromCoinId: from.id ?? from.ticker,
            toCoinId: to.id ?? to.ticker,
            amount: chainAmount,
            affiliateBps,
            oneInchConfig: affiliateConfig?.oneInch,
          })

          return { quote: { general }, discounts: vultDiscount }
        },
      })
    }

    if (isOneOf(fromChain, lifiSwapEnabledChains) && isOneOf(toChain, lifiSwapEnabledChains)) {
      result.push({
        providerName: 'LiFi',
        fetch: async (): Promise<SwapQuote> => {
          const general = await getLifiSwapQuote({
            from: {
              ...from,
              chain: fromChain,
            },
            to: {
              ...to,
              chain: toChain,
            },
            amount: chainAmount,
            affiliateBps,
          })

          return { quote: { general }, discounts: vultDiscount }
        },
      })
    }

    if (isOneOf(fromChain, swapKitSourceChains) && isOneOf(toChain, swapKitEnabledChains)) {
      result.push({
        providerName: 'SwapKit',
        fetch: async (): Promise<SwapQuote> => {
          const general = await getSwapKitQuote({
            from: {
              ...from,
              chain: fromChain,
            },
            to: {
              ...to,
              chain: toChain,
            },
            amount: chainAmount,
            affiliateBps,
          })

          return { quote: { general }, discounts: vultDiscount }
        },
      })
    }

    return result
  }

  const shouldPreferGeneralSwap =
    [from.chain, to.chain].every(chain => isChainOfKind(chain, 'evm')) && [from.id, to.id].some(v => v)

  const fetchers = shouldPreferGeneralSwap
    ? [...getGeneralFetchers(), ...getNativeFetchers()]
    : [...getNativeFetchers(), ...getGeneralFetchers()]

  if (isEmpty(fetchers)) {
    throw new NoSwapRoutesError()
  }

  const settled = await Promise.allSettled(
    fetchers.map(async (fetcher): Promise<RankedSwapQuote> => {
      const quote = await withTimeout(fetcher.fetch(), QUOTE_FETCH_TIMEOUT_MS)
      return {
        quote,
        outputAmount: getComparableOutputAmount(quote, to),
        providerName: fetcher.providerName,
      }
    })
  )
  const best = selectBestEligibleQuote(settled)

  if (best) {
    return best
  }

  // Scan rejected results for actionable size-related signals. Prefer the most
  // specific message available: a provider's "below minimum" hint beats the
  // generic no-route fallback.
  //
  // Provider preference order is INTENTIONALLY stable here — it does NOT mirror
  // the runtime `fetchers[]` array order, which shifts based on
  // `shouldPreferGeneralSwap`. The below-min preference is a separate concept:
  // we pick which provider's hint to surface, not which provider to query
  // first. KyberSwap typically surfaces the cleanest EVM messages, then 1inch
  // and LiFi (cross-chain matrix), then SwapKit (catch-all), then the two
  // native protocols. This ordering is independent of routing and gives
  // deterministic message selection regardless of `Promise.allSettled`
  // resolution order. (#535 r3 — NeO preferably-blocking response.)
  const belowMinimumProviderOrder: SwapQuoteProviderName[] = [
    'KyberSwap',
    '1inch',
    'LiFi',
    'SwapKit',
    'THORChain',
    'MayaChain',
  ]

  const isBelowMinimumMsg = (msg: string) => {
    const lower = msg.toLowerCase()
    return (
      lower.includes('below minimum') ||
      lower.includes('minimum amount') ||
      lower.includes('min amount') ||
      lower.includes('amount too small') ||
      lower.includes('below the minimum')
    )
  }

  const belowMinimumByProvider = new Map<SwapQuoteProviderName, string>()

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status !== 'rejected') {
      continue
    }

    const msg: string = result.reason instanceof Error ? result.reason.message : String(result.reason)

    if (isInError(result.reason, 'dust threshold') || isInError(result.reason, 'amount less than')) {
      throw new Error('Swap amount too small. Please increase the amount to proceed.')
    }

    if (isBelowMinimumMsg(msg)) {
      const providerName = fetchers[i].providerName
      if (!belowMinimumByProvider.has(providerName)) {
        belowMinimumByProvider.set(providerName, msg)
      }
    }
  }

  if (belowMinimumByProvider.size > 0) {
    // Pick the message from the highest-preference provider that has one.
    const preferred = belowMinimumProviderOrder.find(p => belowMinimumByProvider.has(p))
    const belowMinimumMessage = preferred
      ? belowMinimumByProvider.get(preferred)!
      : [...belowMinimumByProvider.values()][0]
    throw new Error(`Amount below the minimum required by a swap provider. ${belowMinimumMessage}`)
  }

  const failedProviders = settled
    .map((result, index) => {
      if (result.status === 'fulfilled') {
        return null
      }

      return fetchers[index].providerName
    })
    .filter((providerName): providerName is SwapQuoteProviderName => providerName !== null)

  throw new Error(`No swap route found after trying ${failedProviders.join(', ')}.`)
}
