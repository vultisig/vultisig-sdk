/**
 * DiscountTierService - Calculates VULT discount tier based on token holdings
 *
 * Automatically fetches VULT token and Thorguard NFT balances on Ethereum
 * to determine the user's discount tier for swap affiliate fees.
 *
 * Discount tiers (based on VULT holdings):
 * - None: 0 VULT → 50 bps fee
 * - Bronze: 1,500 VULT → 45 bps fee
 * - Silver: 3,000 VULT → 40 bps fee
 * - Gold: 7,500 VULT → 30 bps fee
 * - Platinum: 15,000 VULT → 25 bps fee
 * - Diamond: 100,000 VULT → 15 bps fee
 * - Ultimate: 1,000,000 VULT → 0 bps fee
 *
 * Thorguard NFT holders get a free tier upgrade (one level higher),
 * except for platinum or above.
 */

import { Chain } from '@core/chain/Chain'
import { getErc20Balance } from '@core/chain/chains/evm/erc20/getErc20Balance'
import { getErc721Balance } from '@core/chain/chains/evm/erc721/getErc721Balance'
import { vult } from '@core/chain/coin/knownTokens'
import { getVultDiscountTier, VultDiscountTier } from '@core/chain/swap/affiliate'

import { CacheService } from './CacheService'

/** Thorguard NFT contract address on Ethereum */
const THORGUARD_NFT_ADDRESS = '0xa98b29a8f5a247802149c268ecf860b8308b7291'

/** Cache key for discount tier */
const CACHE_KEY = 'discount-tier'

/** Cache TTL: 15 minutes (discount tier changes rarely) */
const DISCOUNT_TIER_TTL = 15 * 60 * 1000

export class DiscountTierService {
  constructor(
    private cacheService: CacheService,
    private getEthereumAddress: () => Promise<string>
  ) {}

  /**
   * Get the user's VULT discount tier
   *
   * Fetches VULT token and Thorguard NFT balances on Ethereum,
   * then calculates the discount tier. Results are cached for 15 minutes.
   *
   * @returns Discount tier or null if user doesn't qualify for any tier
   */
  async getDiscountTier(): Promise<VultDiscountTier | null> {
    return this.cacheService.getOrCompute(CACHE_KEY, DISCOUNT_TIER_TTL, async () => {
      const address = await this.getEthereumAddress()

      // Fetch both balances in parallel
      const [vultBalance, thorguardNftBalance] = await Promise.all([
        getErc20Balance({
          chain: Chain.Ethereum,
          address: vult.id as `0x${string}`,
          accountAddress: address as `0x${string}`,
        }).catch(() => 0n),
        getErc721Balance({
          chain: Chain.Ethereum,
          address: THORGUARD_NFT_ADDRESS as `0x${string}`,
          accountAddress: address as `0x${string}`,
        }).catch(() => 0n),
      ])

      return getVultDiscountTier({ vultBalance, thorguardNftBalance })
    })
  }

  /**
   * Invalidate the cached discount tier
   *
   * Call this after the user acquires more VULT tokens or a Thorguard NFT
   * to force a fresh calculation on the next getDiscountTier() call.
   */
  invalidateCache(): void {
    this.cacheService.clear(CACHE_KEY)
  }
}
