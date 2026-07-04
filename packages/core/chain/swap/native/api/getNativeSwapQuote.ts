import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

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
import { buildAffiliateParams, NativeSwapAffiliateConfig } from './affiliate'

type GetNativeSwapQuoteInput = Record<TransferDirection, AccountCoin> & {
  swapChain: NativeSwapChain
  destination: string
  amount: number
  slippageToleranceBps?: number
  referral?: string
  affiliateBps?: number
  nativeAffiliateConfig?: NativeSwapAffiliateConfig
}

type NativeSwapQuoteErrorResponse = {
  error: string
}

type NativeSwapQuoteResponse = Omit<NativeSwapQuote, 'swapChain'>

const THORCHAIN_STREAMING_SWAP_INTERVAL = 1
export const DEFAULT_NATIVE_SWAP_SLIPPAGE_TOLERANCE_BPS = 100

const assertValidSlippageToleranceBps = (slippageToleranceBps: number): void => {
  if (!Number.isSafeInteger(slippageToleranceBps) || slippageToleranceBps < 0 || slippageToleranceBps > 10_000) {
    throw new Error(`slippageToleranceBps must be an integer between 0 and 10000. Received "${slippageToleranceBps}".`)
  }
}

const requestNativeSwapQuote = async ({
  swapChain,
  swapBaseUrl,
  fromAsset,
  toAsset,
  chainAmount,
  destination,
  streamingInterval,
  streamingQuantity,
  slippageToleranceBps,
  affiliateBps,
  referral,
  nativeAffiliateConfig,
}: {
  swapChain: NativeSwapChain
  swapBaseUrl: string
  fromAsset: string
  toAsset: string
  chainAmount: bigint
  destination: string
  streamingInterval: number
  streamingQuantity?: number
  slippageToleranceBps: number
  affiliateBps?: number
  referral?: string
  nativeAffiliateConfig?: NativeSwapAffiliateConfig
}): Promise<NativeSwapQuoteResponse | NativeSwapQuoteErrorResponse> => {
  const params = new URLSearchParams({
    from_asset: fromAsset,
    to_asset: toAsset,
    amount: chainAmount.toString(),
    destination,
    streaming_interval: String(streamingInterval),
    liquidity_tolerance_bps: String(slippageToleranceBps),
    ...(streamingQuantity !== undefined ? { streaming_quantity: String(streamingQuantity) } : {}),
    ...(affiliateBps !== undefined
      ? buildAffiliateParams({
          swapChain,
          referral,
          affiliateBps,
          config: nativeAffiliateConfig,
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
      throw new Error(`Not enough ${ticker} to cover gas fees.`)
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
  slippageToleranceBps = DEFAULT_NATIVE_SWAP_SLIPPAGE_TOLERANCE_BPS,
  affiliateBps,
  referral,
  nativeAffiliateConfig,
}: GetNativeSwapQuoteInput): Promise<NativeSwapQuote> => {
  assertValidSlippageToleranceBps(slippageToleranceBps)

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
      slippageToleranceBps,
      affiliateBps,
      referral,
      nativeAffiliateConfig,
    })

    return {
      ...assertOkQuote(result, from),
      swapChain,
      liquidity_tolerance_bps: slippageToleranceBps,
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
    slippageToleranceBps,
    affiliateBps,
    referral,
    nativeAffiliateConfig,
  })

  const rapid = assertOkQuote(rapidResult, from)

  const totalBps = rapid.fees.total_bps
  if (totalBps === undefined || totalBps <= THORCHAIN_STREAMING_SLIPPAGE_THRESHOLD_BPS) {
    return { ...rapid, swapChain, liquidity_tolerance_bps: slippageToleranceBps }
  }

  const streamingQuantity =
    rapid.max_streaming_quantity !== undefined && rapid.max_streaming_quantity > 0
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
      slippageToleranceBps,
      affiliateBps,
      referral,
      nativeAffiliateConfig,
    })
    streaming = assertOkQuote(streamingRes, from)
  } catch (error) {
    console.warn('[thorchain] streaming quote failed after elevated rapid slippage; using rapid quote', error)
    return { ...rapid, swapChain, liquidity_tolerance_bps: slippageToleranceBps }
  }

  try {
    if (BigInt(streaming.expected_amount_out) > BigInt(rapid.expected_amount_out)) {
      return { ...streaming, swapChain, liquidity_tolerance_bps: slippageToleranceBps }
    }
  } catch {
    return { ...rapid, swapChain, liquidity_tolerance_bps: slippageToleranceBps }
  }

  return { ...rapid, swapChain, liquidity_tolerance_bps: slippageToleranceBps }
}
