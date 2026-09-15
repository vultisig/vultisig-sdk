import { Chain } from '../../../Chain'
import { baseAffiliateBps } from '../../affiliate/config'
import type { SwapQuoteAffiliate } from '../../quote/SwapQuote'
import { nativeSwapAffiliateConfig } from '../nativeSwapAffiliateConfig'
import { NativeSwapChain } from '../NativeSwapChain'

export type NativeSwapAffiliateConfig = typeof nativeSwapAffiliateConfig

type BuildAffiliateParamsInput = {
  swapChain: NativeSwapChain
  referral?: string
  affiliateBps: number
  config?: NativeSwapAffiliateConfig
}

type AffiliateParams = {
  affiliate: string
  affiliate_bps: string
}

export const buildNativeAffiliateRequest = ({
  swapChain,
  referral,
  affiliateBps,
  config = nativeSwapAffiliateConfig,
}: BuildAffiliateParamsInput): { params: AffiliateParams; affiliate: SwapQuoteAffiliate } => {
  const affiliateParams: NonNullable<SwapQuoteAffiliate['allocations']> = []

  if (swapChain === Chain.THORChain && referral) {
    affiliateParams.push({
      recipient: referral,
      role: 'referrer',
      bps: config.referrerFeeRateBps,
    })
    affiliateParams.push({
      recipient: config.affiliateFeeAddress,
      role: 'affiliate',
      bps: Math.max(0, affiliateBps - (baseAffiliateBps - config.referralDiscountAffiliateFeeRateBps)),
    })
  } else {
    affiliateParams.push({
      recipient: config.affiliateFeeAddress,
      role: 'affiliate',
      bps: affiliateBps,
    })
  }

  return {
    params: {
      affiliate: affiliateParams.map(param => param.recipient).join('/'),
      affiliate_bps: affiliateParams.map(param => param.bps).join('/'),
    },
    affiliate: {
      affiliateBps: affiliateParams.reduce((sum, param) => sum + param.bps, 0),
      request: 'included',
      allocations: affiliateParams,
    },
  }
}

export const buildAffiliateParams = (input: BuildAffiliateParamsInput): AffiliateParams =>
  buildNativeAffiliateRequest(input).params
