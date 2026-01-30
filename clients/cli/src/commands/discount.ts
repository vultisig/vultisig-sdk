/**
 * Discount Tier Commands - view VULT discount tier and fee savings
 */
import chalk from 'chalk'

import type { CommandContext } from '../core'
import { createSpinner, info, isJsonOutput, outputJson, printResult } from '../lib/output'

// Tier configuration (mirrored from @core/chain/swap/affiliate/config)
const TIER_CONFIG = {
  none: { bps: 50, discount: 0 },
  bronze: { bps: 45, discount: 5, minVult: 1500 },
  silver: { bps: 40, discount: 10, minVult: 3000 },
  gold: { bps: 30, discount: 20, minVult: 7500 },
  platinum: { bps: 25, discount: 25, minVult: 15000 },
  diamond: { bps: 15, discount: 35, minVult: 100000 },
  ultimate: { bps: 0, discount: 50, minVult: 1000000 },
} as const

type TierName = keyof typeof TIER_CONFIG

export type DiscountOptions = {
  refresh?: boolean
}

export type DiscountTierInfo = {
  tier: TierName
  feeBps: number
  discountBps: number
  nextTier: {
    name: TierName
    vultRequired: number
  } | null
}

/**
 * Get tier display color based on tier level
 */
function getTierColor(tier: TierName): (text: string) => string {
  const colors: Record<TierName, (text: string) => string> = {
    none: chalk.gray,
    bronze: chalk.hex('#CD7F32'),
    silver: chalk.hex('#C0C0C0'),
    gold: chalk.hex('#FFD700'),
    platinum: chalk.hex('#E5E4E2'),
    diamond: chalk.hex('#B9F2FF'),
    ultimate: chalk.hex('#FF00FF'),
  }
  return colors[tier] || chalk.white
}

/**
 * Get the next tier after the current one
 */
function getNextTier(currentTier: TierName): { name: TierName; vultRequired: number } | null {
  const tierOrder: TierName[] = ['none', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ultimate']
  const currentIndex = tierOrder.indexOf(currentTier)

  if (currentIndex === -1 || currentIndex >= tierOrder.length - 1) {
    return null
  }

  const nextTierName = tierOrder[currentIndex + 1]
  const config = TIER_CONFIG[nextTierName]

  if ('minVult' in config) {
    return { name: nextTierName, vultRequired: config.minVult }
  }

  return null
}

/**
 * Execute discount command - show user's VULT discount tier
 */
export async function executeDiscount(ctx: CommandContext, options: DiscountOptions = {}): Promise<DiscountTierInfo> {
  const vault = await ctx.ensureActiveVault()

  const spinner = createSpinner(options.refresh ? 'Refreshing discount tier...' : 'Loading discount tier...')

  // Get or refresh the tier
  const tierResult = options.refresh ? await vault.updateDiscountTier() : await vault.getDiscountTier()

  const tier = (tierResult as TierName) || 'none'
  const config = TIER_CONFIG[tier]
  const nextTier = getNextTier(tier)

  const tierInfo: DiscountTierInfo = {
    tier,
    feeBps: config.bps,
    discountBps: config.discount,
    nextTier,
  }

  spinner.succeed('Discount tier loaded')

  if (isJsonOutput()) {
    outputJson({
      tier: tierInfo.tier,
      feeBps: tierInfo.feeBps,
      discountBps: tierInfo.discountBps,
      nextTier: tierInfo.nextTier,
    })
    return tierInfo
  }

  displayDiscountTier(tierInfo)

  return tierInfo
}

/**
 * Display formatted discount tier information
 */
function displayDiscountTier(tierInfo: DiscountTierInfo): void {
  const tierColor = getTierColor(tierInfo.tier)

  printResult(chalk.cyan('\n+----------------------------------------+'))
  printResult(chalk.cyan('|          VULT Discount Tier            |'))
  printResult(chalk.cyan('+----------------------------------------+\n'))

  // Current tier
  const tierDisplay =
    tierInfo.tier === 'none'
      ? chalk.gray('No Tier')
      : tierColor(tierInfo.tier.charAt(0).toUpperCase() + tierInfo.tier.slice(1))
  printResult(`  Current Tier:   ${tierDisplay}`)

  // Fee information
  if (tierInfo.tier === 'none') {
    printResult(`  Swap Fee:       ${chalk.gray('50 bps (0.50%)')}`)
    printResult(`  Discount:       ${chalk.gray('None')}`)
  } else {
    printResult(`  Swap Fee:       ${chalk.green(`${tierInfo.feeBps} bps (${(tierInfo.feeBps / 100).toFixed(2)}%)`)}`)
    printResult(`  Discount:       ${chalk.green(`${tierInfo.discountBps} bps saved`)}`)
  }

  // Next tier info
  if (tierInfo.nextTier) {
    const nextTierColor = getTierColor(tierInfo.nextTier.name)
    printResult(chalk.bold('\n  Next Tier:'))
    printResult(
      `    ${nextTierColor(tierInfo.nextTier.name.charAt(0).toUpperCase() + tierInfo.nextTier.name.slice(1))} - requires ${tierInfo.nextTier.vultRequired.toLocaleString()} VULT`
    )
  } else if (tierInfo.tier === 'ultimate') {
    printResult(chalk.bold('\n  ') + chalk.magenta('You have the highest tier! 0% swap fees.'))
  }

  // Thorguard NFT note
  info(chalk.gray('\n  Tip: Thorguard NFT holders get +1 tier upgrade (up to gold)'))
  printResult('')
}
