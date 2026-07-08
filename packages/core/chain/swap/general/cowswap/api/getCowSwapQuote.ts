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

  // AGG-01 fund-safety fix (round-2 spec-level audit): sellToken/buyToken/kind/
  // partiallyFillable were previously taken straight from this untrusted /quote response and
  // signed as-is via the EIP-712 GPv2 Order struct (buildCowSwapOrderTypedData.ts). `receiver`
  // just below already uses the caller-supplied local, not quote.receiver — the "don't trust
  // the API for security-critical fields" pattern already existed here, just not applied to
  // these 4 fields. A compromised/buggy apiBase response substituting a token address, or
  // flipping `kind` from 'sell' to 'buy', would get signed: a `kind` flip specifically inverts
  // GPv2's semantics (sell: sellAmount is authoritative post-fee; buy: buyAmount is the fixed
  // target, sellAmount becomes a ceiling) while grossSellAmount below is computed assuming
  // sell-order semantics — the SDK would sign a fundamentally different economic contract than
  // the one it believes it built. This SDK only ever requests kind:'sell' + partiallyFillable:
  // false (the request body above), so any other value in the response is definitionally wrong.
  if (quote.sellToken.toLowerCase() !== sellToken.toLowerCase()) {
    throw new Error(
      `CowSwap quote returned a mismatched sellToken (requested ${sellToken}, got ${quote.sellToken}) — refusing to sign.`
    )
  }
  if (quote.buyToken.toLowerCase() !== buyToken.toLowerCase()) {
    throw new Error(
      `CowSwap quote returned a mismatched buyToken (requested ${buyToken}, got ${quote.buyToken}) — refusing to sign.`
    )
  }
  if (quote.kind !== 'sell') {
    throw new Error(`CowSwap quote returned kind '${quote.kind}' (requested 'sell') — refusing to sign.`)
  }
  if (quote.partiallyFillable !== false) {
    throw new Error(
      `CowSwap quote returned partiallyFillable=${quote.partiallyFillable} (requested false) — refusing to sign.`
    )
  }

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

  // AGG-01 follow-up (codex review, PR #1082): grossSellAmount becomes the signed Order's
  // sellAmount — the SDK's authorized spend — and was, like the 4 fields above, taken entirely
  // from the untrusted response with no check against what was actually requested. CoW's
  // `sellAmountBeforeFee` request param is specifically designed so the API solves for
  // `quote.sellAmount + quote.feeAmount === sellAmountBeforeFee` exactly — live-verified against
  // the real api.cow.fi/mainnet quote endpoint on two different pairs/amounts on 2026-07-08,
  // both matched byte-for-byte, not just approximately. A compromised/buggy response inflating
  // sellAmount or feeAmount would sign authorization to sell MORE than the user requested —
  // the most direct fund-safety consequence of any field in this struct. Same "refuse to sign
  // on mismatch" treatment as the fields above.
  if (grossSellAmount !== sellAmount.toString()) {
    throw new Error(
      `CowSwap quote's sellAmount+feeAmount (${grossSellAmount}) does not match the requested sellAmountBeforeFee (${sellAmount}) — refusing to sign.`
    )
  }

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
