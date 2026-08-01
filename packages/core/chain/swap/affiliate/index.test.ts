import { vult } from '@vultisig/core-chain/coin/knownTokens'
import { describe, expect, it } from 'vitest'

import { getSwapAffiliateBps, getVultDiscountTier } from './index'
import { vultDiscountTierMinBalances } from './config'

const toVultBalance = (amount: number) => BigInt(amount) * 10n ** BigInt(vult.decimals)

describe('getVultDiscountTier (sdk#1677)', () => {
  // Holding exactly the minimum balance of a tier must grant that tier.
  // 100000n * 10n**18n is not representable in float64, so a comparison
  // routed through Number sees 99999.99999999999 and demotes diamond
  // holders to platinum (25 bps affiliate fee instead of 15).
  it.each(Object.entries(vultDiscountTierMinBalances))(
    'grants %s at exactly its minimum balance',
    (tier, minBalance) => {
      expect(
        getVultDiscountTier({
          vultBalance: toVultBalance(minBalance),
          thorguardNftBalance: 0n,
        })
      ).toBe(tier)
    }
  )

  it.each(Object.entries(vultDiscountTierMinBalances))(
    'does not grant %s one base unit below its minimum balance',
    (tier, minBalance) => {
      expect(
        getVultDiscountTier({
          vultBalance: toVultBalance(minBalance) - 1n,
          thorguardNftBalance: 0n,
        })
      ).not.toBe(tier)
    }
  )

  it('returns null below the lowest tier', () => {
    expect(getVultDiscountTier({ vultBalance: 0n, thorguardNftBalance: 0n })).toBeNull()
  })

  it('charges diamond holders 15 bps', () => {
    const tier = getVultDiscountTier({
      vultBalance: toVultBalance(vultDiscountTierMinBalances.diamond),
      thorguardNftBalance: 0n,
    })

    expect(getSwapAffiliateBps(tier)).toBe(15)
  })
})
