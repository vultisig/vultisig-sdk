/**
 * Chain Commands - chains and addresses
 */
import type { Chain } from '@vultisig/sdk/node'
import chalk from 'chalk'

import type { CommandContext } from '../core'
import { createSpinner, info, printResult, success } from '../lib/output'
import { displayAddresses } from '../ui'

export type ChainsOptions = {
  add?: Chain
  remove?: Chain
}

/**
 * Execute chains command - list, add, or remove chains
 */
export async function executeChains(ctx: CommandContext, options: ChainsOptions = {}): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  if (options.add) {
    await vault.addChain(options.add)
    success(`\n+ Added chain: ${options.add}`)
    const address = await vault.address(options.add)
    info(`Address: ${address}`)
  } else if (options.remove) {
    await vault.removeChain(options.remove)
    success(`\n+ Removed chain: ${options.remove}`)
  } else {
    const chains = vault.chains
    printResult(chalk.cyan('\nActive Chains:\n'))
    chains.forEach((chain: Chain) => {
      printResult(`  - ${chain}`)
    })
    info(chalk.gray('\nUse --add <chain> to add a chain or --remove <chain> to remove one'))
  }
}

/**
 * Execute addresses command - show all vault addresses
 */
export async function executeAddresses(ctx: CommandContext): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const spinner = createSpinner('Loading addresses...')
  const addresses = await vault.addresses()

  spinner.succeed('Addresses loaded')
  displayAddresses(addresses)
}
