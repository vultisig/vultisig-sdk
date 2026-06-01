import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getSwapAffiliateBps, VultDiscountTier } from '@vultisig/core-chain/swap/affiliate'
import { SwapDiscount } from '@vultisig/core-chain/swap/discount/SwapDiscount'
import { getCowSwapQuote } from '@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote'
import { cowSwapChainConfig, cowSwapSupportedChains } from '@vultisig/core-chain/swap/general/cowswap/config'
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
import { SwapKitAmountBelowMinimumError } from '@vultisig/core-chain/swap/general/swapkit/SwapKitErrors'
import { NativeSwapAffiliateConfig } from '@vultisig/core-chain/swap/native/api/affiliate'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import {
  getNativeSwapMinAmountIn,
  NativeSwapMinAmountIn,
} from '@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn'
import { nativeSwapChains, nativeSwapEnabledChainsRecord } from '@vultisig/core-chain/swap/native/NativeSwapChain'
import { getNativeSwapDecimals } from '@vultisig/core-chain/swap/native/utils/getNativeSwapDecimals'
import { NoSwapRoutesError } from '@vultisig/core-chain/swap/NoSwapRoutesError'
import { SwapError, SwapErrorCode } from '@vultisig/core-chain/swap/SwapError'
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

type SwapQuoteProviderName = 'CowSwap' | 'KyberSwap' | '1inch' | 'LiFi' | 'SwapKit' | 'THORChain' | 'MayaChain'

type SwapQuoteFetcher = {
  providerName: SwapQuoteProviderName
  fetch: () => Promise<SwapQuote>
}

type RankedSwapQuote = {
  quote: SwapQuote
  outputAmount: bigint
  providerName: SwapQuoteProviderName
}

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
 * Declared preference order for economically equivalent quotes. Quotes are
 * first ranked by comparable net output across all providers. Providers within
 * `SWAP_QUOTE_PREFERENCE_BAND_BPS` of the best output are then selected by this
 * order, so users stay close to the best rate while near-ties prefer native
 * routes and SwapKit economics.
 *
 * CowSwap is intentionally omitted in Phase 1 — see fetcher-registration
 * comment lower in this file. Add it here when the build/sign path is wired.
 *
 * @internal Exported for unit-test introspection only.
 */
export const providerPreferenceOrder: readonly SwapQuoteProviderName[] = [
  'THORChain',
  'MayaChain',
  'SwapKit',
  'KyberSwap',
  '1inch',
  'LiFi',
] as const

/** @deprecated Use `providerPreferenceOrder`. */
export const aggregatorPreferenceOrder = providerPreferenceOrder

const providerPreferenceIndex = new Map<SwapQuoteProviderName, number>(
  providerPreferenceOrder.map((name, idx) => [name, idx])
)

const getProviderPreferenceRank = (name: SwapQuoteProviderName): number =>
  providerPreferenceIndex.get(name) ?? Number.POSITIVE_INFINITY

const SWAP_QUOTE_PREFERENCE_BAND_BPS = 100n
const BPS_DENOMINATOR = 10_000n

const isWithinPreferenceBand = (outputAmount: bigint, bestOutputAmount: bigint): boolean =>
  outputAmount * BPS_DENOMINATOR >= bestOutputAmount * (BPS_DENOMINATOR - SWAP_QUOTE_PREFERENCE_BAND_BPS)

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
  const candidates: RankedSwapQuote[] = []

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      candidates.push(result.value)
    }
  }

  if (candidates.length === 0) {
    return null
  }

  const bestOutputAmount = candidates.reduce(
    (best, candidate) => (candidate.outputAmount > best ? candidate.outputAmount : best),
    candidates[0].outputAmount
  )

  let selected: RankedSwapQuote | null = null
  let selectedPreferenceRank = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    if (!isWithinPreferenceBand(candidate.outputAmount, bestOutputAmount)) {
      continue
    }

    const candidatePreferenceRank = getProviderPreferenceRank(candidate.providerName)
    if (
      selected === null ||
      candidatePreferenceRank < selectedPreferenceRank ||
      (candidatePreferenceRank === selectedPreferenceRank && candidate.outputAmount > selected.outputAmount)
    ) {
      selected = candidate
      selectedPreferenceRank = candidatePreferenceRank
    }
  }

  return selected?.quote ?? null
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
    throw new SwapError(
      SwapErrorCode.InvalidConfig,
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

    // CowSwap: Phase 1 (SDK scaffold only). NOT registered as a live fetcher
    // until Phase 2 wires the build/sign path through `getCowSwapOrder` +
    // `submitCowSwapOrder` (the off-chain order flow, see #471). Registering
    // here while the consumer pipeline can't sign would let CowSwap win a
    // quote and then fail at sign time. The cowswap module + types + tests
    // remain in this PR so Phase 2 only needs to plug in the fetcher block
    // here and the consumer-side dispatch in mcp-ts. (#584 round-1 — Ehsan)
    //
    // void-imports so the dead-code linter doesn't gripe; they're used by
    // sibling tests + ensure the module compiles cleanly.
    void getCowSwapQuote
    void cowSwapChainConfig
    void cowSwapSupportedChains

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

  const generalFetchers = getGeneralFetchers()
  const nativeFetchers = getNativeFetchers()

  const fetchers = shouldPreferGeneralSwap
    ? [...generalFetchers, ...nativeFetchers]
    : [...nativeFetchers, ...generalFetchers]

  if (isEmpty(fetchers)) {
    throw new NoSwapRoutesError()
  }

  // Proactive THORChain minimum (#604). Derived from the destination chain's
  // `outbound_fee` and spot pool prices, this yields an actionable threshold
  // instead of a generic "no route" for sub-minimum amounts. Computed only when
  // a native protocol can route AND we actually need it (sole-family pre-flight
  // or the all-fail path) — never on every quote — so valid swaps pay no extra
  // network cost. Resolves to `null` when not determinable.
  const computeNativeMin = (): Promise<NativeSwapMinAmountIn | null> =>
    matchingSwapChains.includes(Chain.THORChain)
      ? getNativeSwapMinAmountIn({ from, to, swapChain: Chain.THORChain })
      : Promise.resolve(null)

  // Eager short-circuit ONLY when THORChain is the *sole* possible route: no
  // aggregators AND no MayaChain. We only compute a proactive minimum for
  // THORChain (`computeNativeMin`), so if any other family can route — an
  // aggregator (SwapKit/Chainflip) or MayaChain (its own, possibly lower
  // minimum) — short-circuiting on THORChain's number would wrongly reject an
  // amount they could fill. Multi-provider pairs let every provider run and
  // only fall back to the computed minimum if they all fail. (#604, CodeRabbit)
  const thorIsSoleRoute =
    generalFetchers.length === 0 && matchingSwapChains.length === 1 && matchingSwapChains[0] === Chain.THORChain
  if (thorIsSoleRoute) {
    const nativeMin = await computeNativeMin()
    if (nativeMin && amount < nativeMin.minAmountInBaseUnits) {
      throw belowNativeMinimumError(nativeMin, from)
    }
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
    // 'CowSwap' omitted in Phase 1 (no live fetcher — see comment higher up).
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

  // Native protocols halt trading per-chain (THORChain mimir `HALT<CHAIN>TRADING`,
  // pool ragnarok, churn). The quote API then rejects EVERY amount with
  // "trading is halted" — an operational state, not an amount problem. Detect it
  // so we surface a "temporarily unavailable" message instead of the misleading
  // generic "no route" (which reads like the pair is unsupported). Also match the
  // "trading paused" wordings emitted by the THOR halt helpers in
  // `chains/cosmos/thor/lp/halts.ts` (`global trading paused`,
  // `<chain> chain trading paused`). (#604, CodeRabbit)
  const isTradingHaltedMsg = (msg: string) => {
    const lower = msg.toLowerCase()
    return (
      lower.includes('halted') ||
      lower.includes('trading halt') ||
      lower.includes('trading paused') ||
      lower.includes('trading is paused')
    )
  }

  const belowMinimumByProvider = new Map<SwapQuoteProviderName, string>()
  const haltedProviders = new Set<SwapQuoteProviderName>()

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status !== 'rejected') {
      continue
    }

    const msg: string = result.reason instanceof Error ? result.reason.message : String(result.reason)

    // SwapKit raises this only after confirming the pair is structurally
    // supported, so it is unambiguously an amount problem (#4418). Reuse the
    // same copy as the THORChain dust-threshold path.
    if (
      result.reason instanceof SwapKitAmountBelowMinimumError ||
      isInError(result.reason, 'dust threshold') ||
      isInError(result.reason, 'amount less than')
    ) {
      throw new SwapError(SwapErrorCode.AmountTooSmall, 'Swap amount too small. Please increase the amount to proceed.')
    }

    if (isBelowMinimumMsg(msg)) {
      const providerName = fetchers[i].providerName
      if (!belowMinimumByProvider.has(providerName)) {
        belowMinimumByProvider.set(providerName, msg)
      }
    }

    if (isTradingHaltedMsg(msg)) {
      haltedProviders.add(fetchers[i].providerName)
    }
  }

  if (belowMinimumByProvider.size > 0) {
    // Pick the message from the highest-preference provider that has one.
    const preferred = belowMinimumProviderOrder.find(p => belowMinimumByProvider.has(p))
    const belowMinimumMessage = preferred
      ? belowMinimumByProvider.get(preferred)!
      : [...belowMinimumByProvider.values()][0]
    throw new SwapError(
      SwapErrorCode.AmountBelowMinimum,
      `Amount below the minimum required by a swap provider. ${belowMinimumMessage}`
    )
  }

  // Trading-halt takes precedence over the speculative computed minimum and the
  // generic fallback: when a native protocol reports a halt, NO amount can route,
  // so telling the user to "increase the amount" would be actively misleading. A
  // genuine provider-reported below-minimum (handled above) still wins, since
  // that provider is responding and the amount is the actionable lever. (#604)
  if (haltedProviders.size > 0) {
    throw new SwapError(
      SwapErrorCode.TradingHalted,
      `This swap route is temporarily unavailable — trading is halted on ${[...haltedProviders].join(', ')}. Please try again later.`
    )
  }

  // No provider returned a parseable below-minimum hint. Before falling back to
  // the generic "no route" message, check the proactively-computed THORChain
  // minimum: providers reject sub-minimum swaps with wordings we can't reliably
  // match, so the computed threshold is the authoritative signal here (#604).
  const nativeMin = await computeNativeMin()
  if (nativeMin && amount < nativeMin.minAmountInBaseUnits) {
    throw belowNativeMinimumError(nativeMin, from)
  }

  const failedProviders = settled
    .map((result, index) => {
      if (result.status === 'fulfilled') {
        return null
      }

      return fetchers[index].providerName
    })
    .filter((providerName): providerName is SwapQuoteProviderName => providerName !== null)

  // Instrument the fallback (#604): the raw provider messages are the only way
  // to learn which sub-minimum/error wordings still slip through. Logging them
  // makes future classification data-driven instead of guessed.
  const rawProviderErrors = settled
    .map((result, index) =>
      result.status === 'rejected'
        ? `${fetchers[index].providerName}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
        : null
    )
    .filter((entry): entry is string => entry !== null)
  console.warn(
    `[findSwapQuote] no route for ${from.ticker} -> ${to.ticker}; raw provider errors: ${rawProviderErrors.join(' | ')}`
  )

  throw new SwapError(
    SwapErrorCode.AllProvidersFailed,
    `No swap route found after trying ${failedProviders.join(', ')}.`
  )
}

const belowNativeMinimumError = (min: NativeSwapMinAmountIn, from: AccountCoin): SwapError =>
  new SwapError(
    SwapErrorCode.AmountBelowMinimum,
    `Amount is below the minimum for this swap. Minimum is ~${min.minAmountInHuman} ${from.ticker}. Please increase the amount.`
  )
