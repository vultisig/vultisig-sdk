import { vult } from '@vultisig/core-chain/coin/knownTokens'
import { getLastItem } from '@vultisig/lib-utils/array/getLastItem'
import { order } from '@vultisig/lib-utils/array/order'
import { toEntries } from '@vultisig/lib-utils/record/toEntries'

import { toChainAmount } from '../../amount/toChainAmount'
import { baseAffiliateBps, VultDiscountTier, vultDiscountTierBps, vultDiscountTierMinBalances } from './config'

export type { VultDiscountTier }

type GetVultDiscountTierInput = {
  vultBalance: bigint
  thorguardNftBalance: bigint
}

export const getVultDiscountTier = ({
  vultBalance,
  thorguardNftBalance,
}: GetVultDiscountTierInput): VultDiscountTier | null => {
  const descendingTiers = order(toEntries(vultDiscountTierMinBalances), ({ value }) => value, 'desc')

  const baseTier = descendingTiers.find(({ value }) => vultBalance >= toChainAmount(value, vult.decimals))?.key

  if (thorguardNftBalance === 0n) {
    return baseTier ?? null
  }

  if (!baseTier) {
    return getLastItem(descendingTiers).key
  }

  const platinumIndex = descendingTiers.findIndex(({ key }) => key === 'platinum')
  const currentTierIndex = descendingTiers.findIndex(({ key }) => key === baseTier)

  if (currentTierIndex <= platinumIndex) {
    return baseTier
  }

  return descendingTiers[currentTierIndex - 1].key
}

export const getSwapAffiliateBps = (discountTier: VultDiscountTier | null): number => {
  return discountTier ? baseAffiliateBps - vultDiscountTierBps[discountTier] : baseAffiliateBps
}
