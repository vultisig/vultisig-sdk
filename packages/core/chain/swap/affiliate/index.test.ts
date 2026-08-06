import { vult } from '@vultisig/core-chain/coin/knownTokens'
import { describe, expect, it } from 'vitest'

import { VultDiscountTier, vultDiscountTierMinBalances, vultDiscountTiers } from './config'
import { getSwapAffiliateBps, getVultDiscountTier } from './index'

const toVultBalance = (amount: number) => BigInt(amount) * 10n ** BigInt(vult.decimals)

const tierBelowMinimum: Record<VultDiscountTier, VultDiscountTier | null> = {
  bronze: null,
  silver: 'bronze',
  gold: 'silver',
  platinum: 'gold',
  diamond: 'platinum',
  ultimate: 'diamond',
}

describe('getVultDiscountTier (sdk#1677)', () => {
  // Holding exactly the minimum balance of a tier must grant that tier.
  // 100000n * 10n**18n is not representable in float64, so a comparison
  // routed through Number sees 99999.99999999999 and demotes diamond
  // holders to platinum (25 bps affiliate fee instead of 15).
  it.each([...vultDiscountTiers])('grants %s at exactly its minimum balance', tier => {
    expect(
      getVultDiscountTier({
        vultBalance: toVultBalance(vultDiscountTierMinBalances[tier]),
        thorguardNftBalance: 0n,
      })
    ).toBe(tier)
  })

  // One base unit below a minimum must land on the tier below it — float
  // rounding must neither swallow the difference nor skip past a tier.
  it.each([...vultDiscountTiers])('grants the tier below %s one base unit under its minimum', tier => {
    expect(
      getVultDiscountTier({
        vultBalance: toVultBalance(vultDiscountTierMinBalances[tier]) - 1n,
        thorguardNftBalance: 0n,
      })
    ).toBe(tierBelowMinimum[tier])
  })

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

  it('does not round one wei below bronze up into the bronze tier', () => {
    const bronzeThreshold = toVultBalance(vultDiscountTierMinBalances.bronze)

    expect(getVultDiscountTier({ vultBalance: bronzeThreshold - 1n, thorguardNftBalance: 0n })).toBeNull()
  })

  it('preserves the Thorguard upgrade rules', () => {
    expect(getVultDiscountTier({ vultBalance: 0n, thorguardNftBalance: 1n })).toBe('bronze')
    expect(
      getVultDiscountTier({
        vultBalance: toVultBalance(vultDiscountTierMinBalances.gold),
        thorguardNftBalance: 1n,
      })
    ).toBe('platinum')
    expect(
      getVultDiscountTier({
        vultBalance: toVultBalance(vultDiscountTierMinBalances.platinum),
        thorguardNftBalance: 1n,
      })
    ).toBe('platinum')
  })
})
