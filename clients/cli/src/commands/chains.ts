/**
 * Chain Commands - chains and addresses
 */
import type { Chain } from '@vultisig/sdk'
import { SUPPORTED_CHAINS } from '@vultisig/sdk'
import chalk from 'chalk'

import type { CommandContext } from '../core'
import { InvalidChainError, InvalidInputError } from '../core'
import { createSpinner, info, isJsonOutput, outputJson, printResult, success } from '../lib/output'
import { displayAddresses } from '../ui'

const MLDSA_HINT = 'Run "vultisig add-mldsa --email <email>" to add ML-DSA keys to this vault'
const MLDSA_ADD_CHAIN_HINT =
  'Run "vultisig add-mldsa --email <email>" to add ML-DSA keys, then "vultisig chains --add QBTC"'

function addressFailureHint(error: string): string | undefined {
  return /mldsa/i.test(error) ? MLDSA_HINT : undefined
}

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
    const currentChains = new Set(vault.chains)
    const underivable = vault.getUnderivableChains([...SUPPORTED_CHAINS])
    const underivableSet = new Set(underivable)
    const derivable = SUPPORTED_CHAINS.filter(chain => !underivableSet.has(chain))
    const { failures } = await vault.addressesDetailed(underivable)
    const skipped = underivable.map(chain => ({
      chain,
      reason:
        failures.find(failure => failure.chain === chain)?.error ?? 'The vault cannot derive an address for this chain',
      hint: chain === 'QBTC' ? MLDSA_ADD_CHAIN_HINT : 'Add the keys required to derive this chain before enabling it',
    }))
    const spinner = createSpinner(`Adding all ${SUPPORTED_CHAINS.length} supported chains...`)
    await vault.setChains(derivable)
    const addedCount = derivable.filter(chain => !currentChains.has(chain)).length
    spinner.succeed(`Added ${addedCount} chains (${derivable.length} enabled)`)

    if (isJsonOutput()) {
      outputJson({
        chains: [...vault.chains],
        added: addedCount,
        total: SUPPORTED_CHAINS.length,
        skipped,
      })
      return
    }
    info(chalk.gray('\nAll derivable supported chains are now enabled.'))
    skipped.forEach(({ chain, reason, hint }) => {
      info(`Skipped ${chain}: ${reason}`)
      info(hint)
    })
    return
  }

  if (options.add) {
    // Validate against the registry BEFORE persisting. Chain resolution upstream
    // falls back to the raw user string on an unknown name (`... || (input as Chain)`),
    // so an invalid `--add` would otherwise be written to the vault's chain list and
    // then throw on every subsequent address derivation. Fail closed: nothing is
    // persisted for a chain that isn't supported.
    if (!SUPPORTED_CHAINS.includes(options.add)) {
      throw new InvalidChainError(
        `Unsupported chain: "${options.add}"`,
        'Run "vultisig chains" to see the supported chains, or check the spelling.',
        undefined,
        { chain: String(options.add) }
      )
    }
    if (vault.getUnderivableChains([options.add]).length > 0) {
      const { failures } = await vault.addressesDetailed([options.add])
      const reason = failures[0]?.error ?? 'The vault cannot derive an address for this chain'
      throw new InvalidInputError(reason, options.add === 'QBTC' ? MLDSA_ADD_CHAIN_HINT : undefined)
    }
    const alreadyActive = vault.chains.includes(options.add)
    if (!alreadyActive) {
      await vault.addChain(options.add)
    }
    const address = await vault.address(options.add)
    if (isJsonOutput()) {
      outputJson({ chain: options.add, alreadyActive, address, chains: [...vault.chains] })
      return
    }
    success(alreadyActive ? `\nChain already active: ${options.add}` : `\n+ Added chain: ${options.add}`)
    info(`Address: ${address}`)
  } else if (options.remove) {
    await vault.removeChain(options.remove)
    if (isJsonOutput()) {
      outputJson({ chain: options.remove, removed: true, chains: [...vault.chains] })
      return
    }
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
  const { addresses, failures: addressFailures } = await vault.addressesDetailed()
  const failures = addressFailures.map(({ chain, error }) => ({
    chain,
    error,
    ...(addressFailureHint(error) ? { hint: addressFailureHint(error) } : {}),
  }))

  spinner.succeed('Addresses loaded')

  if (isJsonOutput()) {
    outputJson({ addresses, failures })
    return
  }

  displayAddresses(addresses)
  if (failures.length > 0) {
    printResult(`\n${failures.length} chain(s) could not derive an address:`)
    failures.forEach(({ chain, error, hint }) => {
      printResult(`  ${chain}: ${error}`)
      if (hint) printResult(`  ${hint}`)
    })
  }
}
