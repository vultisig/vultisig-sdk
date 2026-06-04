import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { GeneralSwapQuote } from '../../GeneralSwapQuote'
import {
  COWSWAP_DEFAULT_AFFILIATE_BPS,
  COWSWAP_FEE_RECIPIENT,
  CowSwapChainConfig,
  KNOWN_PERMIT_TOKENS,
} from '../config'
import { buildCowSwapAppData, keccak256Hex } from '../sign/buildCowSwapOrder'
import { CowSwapQuoteApiResponse } from '../types'

type CowSwapQuoteRequest = {
  sellToken: string
  buyToken: string
  sellAmountBeforeFee: string
  from: string
  receiver: string
  kind: 'sell' | 'buy'
  signingScheme: 'eip712'
  partiallyFillable: boolean
  appData: string
  appDataHash: string
}

type GetCowSwapQuoteInput = {
  sellToken: string
  buyToken: string
  sellAmount: bigint
  from: string
  receiver: string
  chainConfig: CowSwapChainConfig
  affiliateBps?: number
}

export async function getCowSwapQuote({
  sellToken,
  buyToken,
  sellAmount,
  from,
  receiver,
  chainConfig,
  affiliateBps,
}: GetCowSwapQuoteInput): Promise<GeneralSwapQuote> {
  const bps = affiliateBps ?? COWSWAP_DEFAULT_AFFILIATE_BPS
  const appData = buildCowSwapAppData(bps, COWSWAP_FEE_RECIPIENT)
  const appDataHash = keccak256Hex(appData)

  const body: CowSwapQuoteRequest = {
    sellToken: sellToken.toLowerCase(),
    buyToken: buyToken.toLowerCase(),
    sellAmountBeforeFee: sellAmount.toString(),
    from: from.toLowerCase(),
    receiver: receiver.toLowerCase(),
    kind: 'sell',
    signingScheme: 'eip712',
    partiallyFillable: false,
    appData,
    appDataHash,
  }

  const response = await queryUrl<CowSwapQuoteApiResponse>(`${chainConfig.apiBase}/api/v1/quote`, {
    method: 'POST',
    body,
  })

  const { quote } = response

  const permitRequired = KNOWN_PERMIT_TOKENS[chainConfig.chainId]?.some(
    addr => addr.toLowerCase() === sellToken.toLowerCase()
  )

  // The CoW orderbook requires submitted orders to carry `feeAmount = 0` — the
  // network/solver fee is folded into the price (taken from order surplus), not
  // charged as a discrete field. A non-zero fee is rejected with
  // `{"errorType":"NonZeroFee"}`. The quote returns the NET sellAmount plus a
  // separate feeAmount, so we sell the GROSS amount (net + fee) with a zero fee:
  // the solver recovers its cost from the surplus over `buyAmount`, which was
  // quoted for the net amount. This value is signed AND submitted, so both stay
  // consistent.
  const grossSellAmount = (BigInt(quote.sellAmount) + BigInt(quote.feeAmount)).toString()

  return {
    dstAmount: quote.buyAmount,
    provider: 'cowswap',
    tx: {
      cowswap_order: {
        sellToken: quote.sellToken,
        buyToken: quote.buyToken,
        receiver,
        sellAmount: grossSellAmount,
        buyAmount: quote.buyAmount,
        validTo: quote.validTo,
        appData,
        appDataHash,
        feeAmount: '0',
        kind: quote.kind,
        partiallyFillable: quote.partiallyFillable,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
        chainId: chainConfig.chainId,
        apiBase: chainConfig.apiBase,
        ...(permitRequired ? { permitRequired: true } : {}),
      },
    },
  }
}
