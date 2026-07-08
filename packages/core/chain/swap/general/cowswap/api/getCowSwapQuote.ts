import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { GeneralSwapQuote } from '../../GeneralSwapQuote'
import {
  COWSWAP_DEFAULT_AFFILIATE_BPS,
  COWSWAP_FEE_RECIPIENT,
  COWSWAP_VALID_TO_SECONDS,
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

// This SDK only ever requests a sell order that must fill completely — named here (rather than
// inlined at both the request body below AND the AGG-01 response-echo checks) so the two stay
// in lockstep if that ever changes; comparing against a variable is more robust than duplicating
// the literal in two places (codex review, PR #1082).
const REQUESTED_KIND = 'sell' as const
const REQUESTED_PARTIALLY_FILLABLE = false as const

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
    kind: REQUESTED_KIND,
    signingScheme: 'eip712',
    partiallyFillable: REQUESTED_PARTIALLY_FILLABLE,
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
  if (quote.kind !== REQUESTED_KIND) {
    throw new Error(`CowSwap quote returned kind '${quote.kind}' (requested '${REQUESTED_KIND}') — refusing to sign.`)
  }
  if (quote.partiallyFillable !== REQUESTED_PARTIALLY_FILLABLE) {
    throw new Error(
      `CowSwap quote returned partiallyFillable=${quote.partiallyFillable} (requested ${REQUESTED_PARTIALLY_FILLABLE}) — refusing to sign.`
    )
  }
  // AGG-01 follow-up (codex review, PR #1082): validTo is entirely server-determined (the
  // request sends no validTo of its own, so there is no request-side value to equality-check
  // against — unlike the fields above). Still part of the signed Order struct, so bound it to a
  // generous ceiling (buildCowSwapOrder.ts's sibling implementation computes its OWN local
  // validTo instead of trusting the response at all — this is the softer version of that same
  // instinct): reject a response whose validTo is unreasonably far in the future (a malicious/
  // malfunctioning response making the order executable far beyond user intent) or already in
  // the past (an expired/garbage quote).
  //
  // The ceiling is 4x COWSWAP_VALID_TO_SECONDS, not 2x — live-verified (2026-07-08, real
  // api.cow.fi/mainnet request) that CoW's actual returned validTo is `now + 1800s` (30 min),
  // NOT ~15 min as COWSWAP_VALID_TO_SECONDS alone would suggest (that constant is
  // buildCowSwapOrder.ts's OWN locally-computed TTL, a different value from what the live API
  // returns). A 2x/30-min cap would have sat RIGHT AT the observed real value with zero headroom
  // for clock skew or normal timing variance — exactly the false-block risk the zkSync router
  // case flagged (team-lead review). 4x/60-min gives real headroom over the observed 30-min
  // reality while still catching genuinely-absurd values (hours/days out — the actual threat).
  const nowSeconds = Math.floor(Date.now() / 1000)
  const maxReasonableValidTo = nowSeconds + 4 * COWSWAP_VALID_TO_SECONDS
  if (quote.validTo <= nowSeconds || quote.validTo > maxReasonableValidTo) {
    throw new Error(
      `CowSwap quote returned an unreasonable validTo (${quote.validTo}, now=${nowSeconds}, max=${maxReasonableValidTo}) — refusing to sign.`
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
