/**
 * Settings Commands - currency, server, address-book
 */
import type { FiatCurrency } from '@vultisig/sdk'
import { Chain, fiatCurrencies, fiatCurrencyNameRecord } from '@vultisig/sdk'
import chalk from 'chalk'
import inquirer from 'inquirer'

import type { CommandContext } from '../core'
import {
  createSpinner,
  error,
  info,
  isJsonOutput,
  outputJson,
  printResult,
  printTable,
  success,
  warn,
} from '../lib/output'

/**
 * Execute currency command - view or set currency preference
 */
export async function executeCurrency(ctx: CommandContext, newCurrency?: string): Promise<FiatCurrency> {
  const vault = await ctx.ensureActiveVault()

  if (!newCurrency) {
    const currentCurrency = vault.currency as FiatCurrency
    const currencyName = fiatCurrencyNameRecord[currentCurrency]
    printResult(chalk.cyan('\nCurrent Currency Preference:'))
    printResult(`  ${chalk.green(currentCurrency.toUpperCase())} - ${currencyName}`)
    info(chalk.gray(`\nSupported currencies: ${fiatCurrencies.join(', ')}`))
    info(chalk.gray('Use "npm run wallet currency <code>" to change'))
    return currentCurrency
  }

  const currency = newCurrency.toLowerCase() as FiatCurrency
  if (!fiatCurrencies.includes(currency)) {
    error(`x Invalid currency: ${newCurrency}`)
    warn(`Supported currencies: ${fiatCurrencies.join(', ')}`)
    throw new Error('Invalid currency')
  }

  const spinner = createSpinner('Updating currency preference...')
  await vault.setCurrency(currency)
  spinner.succeed('Currency updated')

  const currencyName = fiatCurrencyNameRecord[currency]
  success(`\n+ Currency preference set to ${currency.toUpperCase()} (${currencyName})`)

  return currency
}

/**
 * Execute server status command
 */
export async function executeServer(ctx: CommandContext): Promise<{
  fastVault: { online: boolean; latency?: number }
  messageRelay: { online: boolean; latency?: number }
}> {
  const spinner = createSpinner('Checking server status...')

  try {
    const status = await ctx.sdk.getServerStatus()
    spinner.succeed('Server status retrieved')

    if (isJsonOutput()) {
      outputJson({ server: status })
      return status
    }

    printResult(chalk.cyan('\nServer Status:\n'))
    printResult(chalk.bold('Fast Vault Server:'))
    printResult(`  Online:   ${status.fastVault.online ? chalk.green('Yes') : chalk.red('No')}`)
    if (status.fastVault.latency) {
      printResult(`  Latency:  ${status.fastVault.latency}ms`)
    }
    printResult(chalk.bold('\nMessage Relay:'))
    printResult(`  Online:   ${status.messageRelay.online ? chalk.green('Yes') : chalk.red('No')}`)
    if (status.messageRelay.latency) {
      printResult(`  Latency:  ${status.messageRelay.latency}ms`)
    }

    return status
  } catch (err: any) {
    spinner.fail('Failed to check server status')
    error(`\nx ${err.message}`)
    throw err
  }
}

export type AddressBookOptions = {
  add?: boolean
  remove?: string
  chain?: Chain
  // Non-interactive options for --add
  address?: string
  name?: string
}

export type AddressBookEntry = {
  chain: Chain
  address: string
  name: string
  source: 'saved' | 'vault'
  dateAdded: number
}

/**
 * Execute address-book command - manage address book
 */
export async function executeAddressBook(
  ctx: CommandContext,
  options: AddressBookOptions = {}
): Promise<AddressBookEntry[]> {
  if (options.add) {
    // Use CLI options if provided, otherwise prompt
    let chain = options.chain
    let address = options.address
    let name = options.name

    const prompts = []
    if (!chain) {
      prompts.push({
        type: 'list',
        name: 'chain',
        message: 'Select chain:',
        choices: Object.values(Chain),
      })
    }
    if (!address) {
      prompts.push({
        type: 'input',
        name: 'address',
        message: 'Enter address:',
        validate: (input: string) => input.trim() !== '' || 'Address is required',
      })
    }
    if (!name) {
      prompts.push({
        type: 'input',
        name: 'name',
        message: 'Enter name/label:',
        validate: (input: string) => input.trim() !== '' || 'Name is required',
      })
    }

    if (prompts.length > 0) {
      const answers = await inquirer.prompt(prompts)
      chain = chain || answers.chain
      address = address || answers.address?.trim()
      name = name || answers.name?.trim()
    }

    const spinner = createSpinner('Adding address to address book...')
    await ctx.sdk.addAddressBookEntry([
      {
        chain: chain!,
        address: address!,
        name: name!,
        source: 'saved' as const,
        dateAdded: Date.now(),
      },
    ])
    spinner.succeed('Address added')

    success(`\n+ Added ${name} (${chain}: ${address})`)
    return []
  }

  if (options.remove) {
    const spinner = createSpinner('Removing address from address book...')
    await ctx.sdk.removeAddressBookEntry([{ address: options.remove, chain: options.chain }])
    spinner.succeed('Address removed')

    success(`\n+ Removed ${options.remove}`)
    return []
  }

  // List address book
  const spinner = createSpinner('Loading address book...')
  const addressBook = await ctx.sdk.getAddressBook(options.chain)
  spinner.succeed('Address book loaded')

  // Combine saved and vault addresses
  const allEntries = [...addressBook.saved, ...addressBook.vaults]

  if (isJsonOutput()) {
    outputJson({ addressBook: allEntries, chain: options.chain })
    return allEntries as AddressBookEntry[]
  }

  if (allEntries.length === 0) {
    warn(`\nNo addresses in address book${options.chain ? ` for ${options.chain}` : ''}`)
    info(chalk.gray('\nUse --add to add an address to the address book'))
  } else {
    printResult(chalk.cyan(`\nAddress Book${options.chain ? ` (${options.chain})` : ''}:\n`))

    const table = allEntries.map(entry => ({
      Name: entry.name,
      Chain: entry.chain,
      Address: entry.address,
      Source: entry.source,
    }))

    printTable(table)

    info(chalk.gray('\nUse --add to add or --remove <address> to remove an address'))
  }

  return allEntries as AddressBookEntry[]
}
