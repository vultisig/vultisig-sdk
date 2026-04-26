import { Minutes } from '@vultisig/lib-utils/time'

export const kyberSwapTxLifespan: Minutes = 20

export const kyberSwapSlippageTolerance: number = 100

export const kyberSwapAffiliateConfig = {
  source: 'vultisig-v0',
  referral: '0x8E247a480449c84a5fDD25974A8501f3EFa4ABb9',
}

export type KyberSwapAffiliateParams = typeof kyberSwapAffiliateConfig & {
  feeAmount: number
  chargeFeeBy: 'currency_out'
  isInBps: true
  feeReceiver: string
}

export const hasAffiliateBps = (
  affiliateBps?: number
): affiliateBps is number =>
  affiliateBps !== undefined && affiliateBps > 0 && affiliateBps < 10000

export const getKyberSwapAffiliateParams = (
  affiliateBps?: number
): KyberSwapAffiliateParams | Record<string, never> =>
  hasAffiliateBps(affiliateBps)
    ? {
        ...kyberSwapAffiliateConfig,
        feeAmount: affiliateBps,
        chargeFeeBy: 'currency_out',
        isInBps: true,
        feeReceiver: kyberSwapAffiliateConfig.referral,
      }
    : {}
