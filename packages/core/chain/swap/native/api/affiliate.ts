import { Chain } from '../../../Chain'
import { baseAffiliateBps } from '../../affiliate/config'
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

export const buildAffiliateParams = ({
  swapChain,
  referral,
  affiliateBps,
  config = nativeSwapAffiliateConfig,
}: BuildAffiliateParamsInput): AffiliateParams => {
  const affiliateParams: Array<{ affiliate: string; bps: number }> = []

  if (swapChain === Chain.THORChain && referral) {
    affiliateParams.push({
      affiliate: referral,
      bps: config.referrerFeeRateBps,
    })
    affiliateParams.push({
      affiliate: config.affiliateFeeAddress,
      bps: Math.max(
        0,
        affiliateBps - (baseAffiliateBps - config.referralDiscountAffiliateFeeRateBps)
      ),
    })
  } else {
    affiliateParams.push({
      affiliate: config.affiliateFeeAddress,
      bps: affiliateBps,
    })
  }

  return {
    affiliate: affiliateParams.map(param => param.affiliate).join('/'),
    affiliate_bps: affiliateParams.map(param => param.bps).join('/'),
  }
}
