/**
 * Chain Commands - chains and addresses
 */
import type { Chain } from '@vultisig/sdk'
import { SUPPORTED_CHAINS } from '@vultisig/sdk'
import chalk from 'chalk'

import type { CommandContext } from '../core'
import { createSpinner, info, isJsonOutput, outputJson, printResult, success } from '../lib/output'
import { displayAddresses } from '../ui'

export type ChainsOptions = {
  add?: Chain
  remove?: Chain
  addAll?: boolean
}

/**
 * Execute chains command - list, add, or remove chains
 */
export async function executeChains(ctx: CommandContext, options: ChainsOptions = {}): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  // Handle --add-all
  if (options.addAll) {
    const currentCount = vault.chains.length
    const spinner = createSpinner(`Adding all ${SUPPORTED_CHAINS.length} supported chains...`)
    await vault.setChains([...SUPPORTED_CHAINS])
    const addedCount = SUPPORTED_CHAINS.length - currentCount
    spinner.succeed(`Added ${addedCount} chains (${SUPPORTED_CHAINS.length} total)`)

    if (isJsonOutput()) {
      outputJson({ chains: [...vault.chains], added: addedCount, total: SUPPORTED_CHAINS.length })
      return
    }
    info(chalk.gray('\nAll supported chains are now enabled.'))
    return
  }

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

    if (isJsonOutput()) {
      outputJson({ chains: [...chains] })
      return
    }

    printResult(chalk.cyan('\nActive Chains:\n'))
    chains.forEach((chain: Chain) => {
      printResult(`  - ${chain}`)
    })
    info(chalk.gray(`\n${chains.length} of ${SUPPORTED_CHAINS.length} chains enabled`))
    info(chalk.gray('Use --add <chain>, --add-all, or --remove <chain>'))
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

  if (isJsonOutput()) {
    outputJson({ addresses })
    return
  }

  displayAddresses(addresses)
}
