import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { lifiSwapEnabledChains } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { getOneInchSwapQuote } from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import { oneInchSwapEnabledChains } from '@vultisig/core-chain/swap/general/oneInch/OneInchSwapEnabledChains'
import { NoSwapRoutesError } from '@vultisig/core-chain/swap/NoSwapRoutesError'
import { isEmpty } from '@vultisig/lib-utils/array/isEmpty'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { bigIntToNumber } from '@vultisig/lib-utils/bigint/bigIntToNumber'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { pick } from '@vultisig/lib-utils/record/pick'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

import { Chain } from '../../Chain'
import { isChainOfKind } from '../../ChainKind'
import { getSwapAffiliateBps, VultDiscountTier } from '../affiliate'
import { SwapDiscount } from '../discount/SwapDiscount'
import { getKyberSwapQuote } from '../general/kyber/api/quote'
import { kyberSwapEnabledChains } from '../general/kyber/chains'
import { getNativeSwapQuote } from '../native/api/getNativeSwapQuote'
import {
  nativeSwapChains,
  nativeSwapEnabledChainsRecord,
} from '../native/NativeSwapChain'
import { SwapQuote } from './SwapQuote'

export type FindSwapQuoteInput = Record<TransferDirection, AccountCoin> & {
  amount: bigint
  referral?: string
  vultDiscountTier?: VultDiscountTier | null
}

type SwapQuoteFetcher = () => Promise<SwapQuote>

type RankedSwapQuote = {
  quote: SwapQuote
  outputAmount: bigint
}

function getComparableOutputAmount(q: SwapQuote): bigint {
  if ('native' in q.quote) {
    return BigInt(q.quote.native.expected_amount_out)
  }
  return BigInt(q.quote.general.dstAmount)
}

function selectBestEligibleQuote(
  settled: PromiseSettledResult<RankedSwapQuote>[]
): SwapQuote | null {
  let best: SwapQuote | null = null
  let bestAmount: bigint | null = null
  let bestIndex = Number.POSITIVE_INFINITY

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status !== 'fulfilled') {
      continue
    }
    const { outputAmount, quote } = result.value
    if (
      bestAmount === null ||
      outputAmount > bestAmount ||
      (outputAmount === bestAmount && i < bestIndex)
    ) {
      best = quote
      bestAmount = outputAmount
      bestIndex = i
    }
  }

  return best
}

export const findSwapQuote = async ({
  from,
  to,
  amount,
  referral,
  vultDiscountTier,
}: FindSwapQuoteInput): Promise<SwapQuote> => {
  const affiliateBps = getSwapAffiliateBps(vultDiscountTier ?? null)

  const vultDiscount: SwapDiscount[] = vultDiscountTier
    ? [{ vult: { tier: vultDiscountTier } }]
    : []

  const referralDiscount: SwapDiscount[] = referral ? [{ referral: {} }] : []

  const involvedChains = [from.chain, to.chain]

  const matchingSwapChains = nativeSwapChains.filter(swapChain =>
    involvedChains.every(chain =>
      isOneOf(chain, nativeSwapEnabledChainsRecord[swapChain])
    )
  )

  const getNativeFetchers = (): SwapQuoteFetcher[] =>
    matchingSwapChains.map(swapChain => async (): Promise<SwapQuote> => {
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
      })

      return {
        quote: { native },
        discounts:
          swapChain === Chain.THORChain
            ? [...vultDiscount, ...referralDiscount]
            : vultDiscount,
      }
    })

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
      result.push(async (): Promise<SwapQuote> => {
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
        })

        return { quote: { general }, discounts: vultDiscount }
      })
    }

    if (
      isOneOf(from.chain, oneInchSwapEnabledChains) &&
      from.chain === to.chain
    ) {
      result.push(async (): Promise<SwapQuote> => {
        const general = await getOneInchSwapQuote({
          account: pick(from, ['address', 'chain']),
          fromCoinId: from.id ?? from.ticker,
          toCoinId: to.id ?? to.ticker,
          amount: chainAmount,
          affiliateBps,
        })

        return { quote: { general }, discounts: vultDiscount }
      })
    }

    if (
      isOneOf(fromChain, lifiSwapEnabledChains) &&
      isOneOf(toChain, lifiSwapEnabledChains)
    ) {
      result.push(async (): Promise<SwapQuote> => {
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
      })
    }

    return result
  }

  const shouldPreferGeneralSwap =
    [from.chain, to.chain].every(chain => isChainOfKind(chain, 'evm')) &&
    [from.id, to.id].some(v => v)

  const fetchers = shouldPreferGeneralSwap
    ? [...getGeneralFetchers(), ...getNativeFetchers()]
    : [...getNativeFetchers(), ...getGeneralFetchers()]

  if (isEmpty(fetchers)) {
    throw new NoSwapRoutesError()
  }

  const settled = await Promise.allSettled(
    fetchers.map(fetcher =>
      Promise.resolve()
        .then(fetcher)
        .then(quote => ({
          quote,
          outputAmount: getComparableOutputAmount(quote),
        }))
    )
  )
  const best = selectBestEligibleQuote(settled)

  if (best) {
    return best
  }

  const last = settled[settled.length - 1]
  const error = last.status === 'rejected' ? last.reason : new Error('No quote')

  if (isInError(error, 'dust threshold')) {
    throw new Error(
      'Swap amount too small. Please increase the amount to proceed.'
    )
  }

  throw error
}
