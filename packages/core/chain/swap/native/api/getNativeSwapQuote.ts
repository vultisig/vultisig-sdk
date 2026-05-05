import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'
import { t } from 'i18next'

import { chainFeeCoin } from '../../../coin/chainFeeCoin'
import { toNativeSwapAsset } from '../asset/toNativeSwapAsset'
import {
  nativeSwapApiBaseUrl,
  NativeSwapChain,
  nativeSwapStreamingInterval,
  THORCHAIN_STREAMING_SLIPPAGE_THRESHOLD_BPS,
} from '../NativeSwapChain'
import { NativeSwapQuote } from '../NativeSwapQuote'
import { getNativeSwapDecimals } from '../utils/getNativeSwapDecimals'
import { buildAffiliateParams } from './affiliate'

type GetNativeSwapQuoteInput = Record<TransferDirection, AccountCoin> & {
  swapChain: NativeSwapChain
  destination: string
  amount: number
  referral?: string
  affiliateBps?: number
}

type NativeSwapQuoteErrorResponse = {
  error: string
}

type NativeSwapQuoteResponse = Omit<NativeSwapQuote, 'swapChain'>

const THORCHAIN_STREAMING_SWAP_INTERVAL = 1

const requestNativeSwapQuote = async ({
  swapChain,
  swapBaseUrl,
  fromAsset,
  toAsset,
  chainAmount,
  destination,
  streamingInterval,
  streamingQuantity,
  affiliateBps,
  referral,
  from,
}: {
  swapChain: NativeSwapChain
  swapBaseUrl: string
  fromAsset: string
  toAsset: string
  chainAmount: bigint
  destination: string
  streamingInterval: number
  streamingQuantity?: number
  affiliateBps?: number
  referral?: string
  from: AccountCoin
}): Promise<NativeSwapQuoteResponse | NativeSwapQuoteErrorResponse> => {
  const params = new URLSearchParams({
    from_asset: fromAsset,
    to_asset: toAsset,
    amount: chainAmount.toString(),
    destination,
    streaming_interval: String(streamingInterval),
    ...(streamingQuantity !== undefined
      ? { streaming_quantity: String(streamingQuantity) }
      : {}),
    ...(affiliateBps !== undefined
      ? buildAffiliateParams({
          swapChain,
          referral,
          affiliateBps,
        })
      : {}),
  })

  const url = `${swapBaseUrl}?${params.toString()}`

  return queryUrl<NativeSwapQuoteResponse | NativeSwapQuoteErrorResponse>(url)
}

const assertOkQuote = (
  result: NativeSwapQuoteResponse | NativeSwapQuoteErrorResponse,
  from: AccountCoin
): NativeSwapQuoteResponse => {
  if ('error' in result) {
    if (isInError(result.error, 'not enough asset to pay for fees')) {
      const { ticker } = chainFeeCoin[from.chain]
      throw new Error(
        t('not_enough_asset_to_cover_gas_fees', { asset: ticker })
      )
    }
    throw new Error(result.error)
  }
  return result
}

export const getNativeSwapQuote = async ({
  swapChain,
  destination,
  from,
  to,
  amount,
  affiliateBps,
  referral,
}: GetNativeSwapQuoteInput): Promise<NativeSwapQuote> => {
  const [fromAsset, toAsset] = [from, to].map(asset => toNativeSwapAsset(asset))

  const fromDecimals = getNativeSwapDecimals(from)

  const chainAmount = toChainAmount(amount, fromDecimals)

  const swapBaseUrl = `${nativeSwapApiBaseUrl[swapChain]}/quote/swap`

  if (swapChain !== Chain.THORChain) {
    const result = await requestNativeSwapQuote({
      swapChain,
      swapBaseUrl,
      fromAsset,
      toAsset,
      chainAmount,
      destination,
      streamingInterval: nativeSwapStreamingInterval[swapChain],
      affiliateBps,
      referral,
      from,
    })

    return {
      ...assertOkQuote(result, from),
      swapChain,
    }
  }

  const rapidResult = await requestNativeSwapQuote({
    swapChain,
    swapBaseUrl,
    fromAsset,
    toAsset,
    chainAmount,
    destination,
    streamingInterval: nativeSwapStreamingInterval[swapChain],
    affiliateBps,
    referral,
    from,
  })

  const rapid = assertOkQuote(rapidResult, from)

  const totalBps = rapid.fees.total_bps
  if (
    totalBps === undefined ||
    totalBps <= THORCHAIN_STREAMING_SLIPPAGE_THRESHOLD_BPS
  ) {
    return { ...rapid, swapChain }
  }

  const streamingQuantity =
    rapid.max_streaming_quantity !== undefined &&
    rapid.max_streaming_quantity > 0
      ? rapid.max_streaming_quantity
      : undefined

  let streaming: NativeSwapQuoteResponse
  try {
    const streamingRes = await requestNativeSwapQuote({
      swapChain,
      swapBaseUrl,
      fromAsset,
      toAsset,
      chainAmount,
      destination,
      streamingInterval: THORCHAIN_STREAMING_SWAP_INTERVAL,
      streamingQuantity,
      affiliateBps,
      referral,
      from,
    })
    streaming = assertOkQuote(streamingRes, from)
  } catch (error) {
    console.warn(
      '[thorchain] streaming quote failed after elevated rapid slippage; using rapid quote',
      error
    )
    return { ...rapid, swapChain }
  }

  try {
    if (
      BigInt(streaming.expected_amount_out) > BigInt(rapid.expected_amount_out)
    ) {
      return { ...streaming, swapChain }
    }
  } catch {
    return { ...rapid, swapChain }
  }

  return { ...rapid, swapChain }
}
