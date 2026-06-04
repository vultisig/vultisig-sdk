import { keccak256, stringToHex } from 'viem'

import {
  COWSWAP_APP_CODE,
  COWSWAP_APP_VERSION,
  COWSWAP_DEFAULT_AFFILIATE_BPS,
  COWSWAP_FEE_RECIPIENT,
  COWSWAP_VALID_TO_SECONDS,
} from '../config'
import { CowSwapOrderKind, CowSwapQuoteApiResponse } from '../types'

export type CowSwapTokenBalance = 'erc20' | 'external' | 'internal'

export type CowSwapOrder = {
  sellToken: string
  buyToken: string
  receiver: string
  sellAmount: string
  buyAmount: string
  validTo: number
  appData: string
  appDataHash: string
  feeAmount: string
  kind: CowSwapOrderKind
  partiallyFillable: boolean
  sellTokenBalance: CowSwapTokenBalance
  buyTokenBalance: CowSwapTokenBalance
}

export type BuildCowSwapOrderInput = {
  quoteResponse: CowSwapQuoteApiResponse
  receiver: string
  affiliateBps?: number
}

/** Canonical appData JSON for a given affiliate configuration. */
export function buildCowSwapAppData(affiliateBps: number, feeRecipient: string): string {
  return JSON.stringify({
    appCode: COWSWAP_APP_CODE,
    version: COWSWAP_APP_VERSION,
    metadata: {
      partnerFee: {
        bps: affiliateBps,
        recipient: feeRecipient.toLowerCase(),
      },
    },
  })
}

/** Compute keccak256 of an arbitrary string. Uses viem's battle-tested
 * implementation rather than a hand-rolled one. Returns a 0x-prefixed
 * 32-byte hex string. */
export function keccak256Hex(input: string): string {
  return keccak256(stringToHex(input))
}

/** Build a CowSwap Order struct from a quote API response. */
export function buildCowSwapOrder({ quoteResponse, receiver, affiliateBps }: BuildCowSwapOrderInput): CowSwapOrder {
  const bps = affiliateBps ?? COWSWAP_DEFAULT_AFFILIATE_BPS
  const appData = buildCowSwapAppData(bps, COWSWAP_FEE_RECIPIENT)
  const appDataHash = keccak256Hex(appData)
  const validTo = Math.floor(Date.now() / 1000) + COWSWAP_VALID_TO_SECONDS

  const { quote } = quoteResponse

  return {
    sellToken: quote.sellToken,
    buyToken: quote.buyToken,
    receiver,
    sellAmount: quote.sellAmount,
    buyAmount: quote.buyAmount,
    validTo,
    appData,
    appDataHash,
    feeAmount: quote.feeAmount,
    kind: quote.kind,
    partiallyFillable: quote.partiallyFillable,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
  }
}
