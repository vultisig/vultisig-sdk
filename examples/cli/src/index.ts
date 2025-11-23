#!/usr/bin/env node
import 'dotenv/config'

import {
  Chain,
  fiatCurrencies,
  FiatCurrency,
  fiatCurrencyNameRecord,
  GlobalConfig,
} from '@vultisig/sdk'
import chalk from 'chalk'
import { program } from 'commander'
import inquirer from 'inquirer'
import ora from 'ora'

import { TransactionManager } from './transaction'
import { VaultManager } from './wallet'

// Global state
let vaultManager: VaultManager
let transactionManager: TransactionManager

/**
 * Parse VAULT_PASSWORDS env var into a Map
 * Format: "VaultName:password VaultId:password"
 */
function parseVaultPasswords(): Map<string, string> {
  const passwordMap = new Map<string, string>()
  const passwordsEnv = process.env.VAULT_PASSWORDS

  if (passwordsEnv) {
    // Split by spaces to get individual vault:password pairs
    const pairs = passwordsEnv.trim().split(/\s+/)
    for (const pair of pairs) {
      const colonIndex = pair.indexOf(':')
      if (colonIndex > 0) {
        const vaultKey = pair.substring(0, colonIndex)
        const password = pair.substring(colonIndex + 1)
        passwordMap.set(vaultKey, password)
      }
    }
  }

  return passwordMap
}

// Configure password handling
GlobalConfig.configure({
  onPasswordRequired: async (vaultId: string, vaultName?: string) => {
    // Try to find password in environment variables
    // Priority: 1. VAULT_PASSWORDS by name, 2. VAULT_PASSWORDS by ID, 3. VAULT_PASSWORD fallback, 4. Prompt user
    const vaultPasswords = parseVaultPasswords()

    // Try vault name first (if provided)
    if (vaultName && vaultPasswords.has(vaultName)) {
      return vaultPasswords.get(vaultName)!
    }

    // Try vault ID
    if (vaultPasswords.has(vaultId)) {
      return vaultPasswords.get(vaultId)!
    }

    // Try single VAULT_PASSWORD as fallback
    if (process.env.VAULT_PASSWORD) {
      return process.env.VAULT_PASSWORD
    }

    // No stored password found, prompt user
    const { password } = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: `Enter password for vault "${vaultName || vaultId}":`,
        mask: '*',
      },
    ])
    return password
  },
})

// Initialize managers
async function init() {
  if (!vaultManager) {
    vaultManager = new VaultManager()
    await vaultManager.initialize()
    const vault = vaultManager.getActiveVault()
    if (vault) {
      transactionManager = new TransactionManager(vault)
    }
  }
}

// Wrapper to handle command execution and exit
function withExit(handler: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await handler(...args)
      process.exit(0)
    } catch (error: any) {
      if (error.exitCode !== undefined) {
        process.exit(error.exitCode)
      }
      console.error(chalk.red(`\n✗ ${error.message}`))
      process.exit(1)
    }
  }
}

// Command: Create new vault
program
  .command('create')
  .description('Create a new vault')
  .option('--type <type>', 'Vault type: fast or secure', 'fast')
  .action(
    withExit(async (options: { type: string }) => {
      await init()

      // Validate vault type
      const vaultType = options.type.toLowerCase()
      if (vaultType !== 'fast' && vaultType !== 'secure') {
        throw new Error('Invalid vault type. Must be "fast" or "secure"')
      }

      // Collect common vault details
      const answers = (await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Enter vault name:',
          validate: (input: string) =>
            input.trim() !== '' || 'Name is required',
        },
        {
          type: 'password',
          name: 'password',
          message: 'Enter password:',
          mask: '*',
          validate: (input: string) =>
            input.length >= 8 || 'Password must be at least 8 characters',
        },
        {
          type: 'password',
          name: 'confirmPassword',
          message: 'Confirm password:',
          mask: '*',
          validate: (input: string, answers: any) =>
            input === answers.password || 'Passwords do not match',
        },
      ])) as any

      if (vaultType === 'fast') {
        // Fast vault - requires email for server backup
        const { email } = await inquirer.prompt([
          {
            type: 'input',
            name: 'email',
            message: 'Enter email for verification:',
            validate: (input: string) =>
              /\S+@\S+\.\S+/.test(input) || 'Invalid email format',
          },
        ])

        // Create fast vault
        const result = await vaultManager.createVault(
          answers.name,
          answers.password,
          email
        )

        // Handle email verification
        if (result.verificationRequired) {
          console.log(
            chalk.yellow(
              '\n📧 A verification code has been sent to your email.'
            )
          )
          console.log(chalk.blue('Please check your inbox and enter the code.'))

          const { code } = await inquirer.prompt([
            {
              type: 'input',
              name: 'code',
              message: `Verification code sent to ${email}. Enter code:`,
              validate: (input: string) =>
                /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
            },
          ])

          const verified = await vaultManager.verifyVault(result.vaultId, code)

          if (!verified) {
            console.error(
              chalk.red(
                '\n✗ Verification failed. Please check the code and try again.'
              )
            )
            console.log(chalk.yellow('\nTo retry verification, use:'))
            console.log(chalk.cyan(`  npm run wallet verify ${result.vaultId}`))
            console.log(chalk.yellow('\nTo resend the verification email:'))
            console.log(
              chalk.cyan(`  npm run wallet verify ${result.vaultId} --resend`)
            )
            const error: any = new Error('Verification failed')
            error.exitCode = 1
            throw error
          }
        }
      } else {
        // Secure vault - requires threshold and total shares
        const secureOptions = (await inquirer.prompt([
          {
            type: 'number',
            name: 'threshold',
            message: 'Signing threshold (m):',
            default: 2,
            validate: (input: number) =>
              input > 0 || 'Threshold must be greater than 0',
          },
          {
            type: 'number',
            name: 'totalShares',
            message: 'Total shares (n):',
            default: 3,
            validate: (input: number, answers: any) =>
              input >= answers.threshold ||
              `Total shares must be >= threshold (${answers.threshold})`,
          },
        ])) as any

        // Create secure vault
        await vaultManager.createSecureVault(
          answers.name,
          answers.password,
          secureOptions.threshold,
          secureOptions.totalShares
        )

        console.log(
          chalk.yellow(
            `\n⚠️  Important: Save your vault backup file (.vult) in a secure location.`
          )
        )
        console.log(
          chalk.yellow(
            `This is a ${secureOptions.threshold}-of-${secureOptions.totalShares} vault. You'll need ${secureOptions.threshold} devices to sign transactions.`
          )
        )
      }

      console.log(chalk.green('\n✓ Vault created!'))
      console.log(
        chalk.blue('\nYour vault is ready. Run the following commands:')
      )
      console.log(
        chalk.cyan('  npm run wallet balance     ') + '- View balances'
      )
      console.log(
        chalk.cyan('  npm run wallet addresses   ') + '- View addresses'
      )
      console.log(
        chalk.cyan('  npm run wallet portfolio   ') + '- View portfolio value'
      )
    })
  )

// Command: Import vault from file
program
  .command('import <file>')
  .description('Import vault from .vult file')
  .action(
    withExit(async (file: string) => {
      await init()

      const { password } = await inquirer.prompt([
        {
          type: 'password',
          name: 'password',
          message: 'Enter vault password (if encrypted):',
          mask: '*',
        },
      ])

      const vault = await vaultManager.importVault(file, password || undefined)
      transactionManager = new TransactionManager(vault)

      console.log(chalk.green('\n✓ Vault imported successfully!'))
      console.log(chalk.blue('\nRun "npm run wallet balance" to view balances'))
    })
  )

// Command: Verify vault with email code
program
  .command('verify <vaultId>')
  .description('Verify vault with email verification code')
  .option('-r, --resend', 'Resend verification email')
  .action(
    withExit(async (vaultId: string, options: { resend?: boolean }) => {
      await init()

      // Optionally resend verification email
      if (options.resend) {
        const spinner = ora('Resending verification email...').start()
        await vaultManager.resendVerification(vaultId)
        spinner.succeed('Verification email sent!')
        console.log(
          chalk.blue('Check your inbox for the new verification code.')
        )
      }

      // Prompt for verification code
      const { code } = await inquirer.prompt([
        {
          type: 'input',
          name: 'code',
          message: 'Enter verification code:',
          validate: (input: string) =>
            /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
        },
      ])

      // Verify the vault
      const verified = await vaultManager.verifyVault(vaultId, code)

      if (verified) {
        console.log(chalk.green('\n✓ Vault verified successfully!'))
      } else {
        console.error(
          chalk.red(
            '\n✗ Verification failed. Please check the code and try again.'
          )
        )
        console.log(
          chalk.yellow('\nTip: Use --resend to get a new verification code:')
        )
        console.log(chalk.cyan(`  npm run wallet verify ${vaultId} --resend`))
        const error: any = new Error('Verification failed')
        error.exitCode = 1
        throw error
      }
    })
  )

// Command: Show balances
program
  .command('balance [chain]')
  .description('Show balance for a chain or all chains')
  .option('-t, --tokens', 'Include token balances')
  .action(
    withExit(
      async (chainStr: string | undefined, options: { tokens?: boolean }) => {
        await init()

        if (!vaultManager.getActiveVault()) {
          throw new Error('No active vault. Create or import a vault first.')
        }

        const spinner = ora('Loading balances...').start()

        if (chainStr) {
          // Show balance for specific chain
          const chain = chainStr as Chain
          const balance = await vaultManager.getBalance(chain)

          spinner.succeed('Balance loaded')

          console.log(chalk.cyan(`\n${chain} Balance:`))
          console.log(`  Amount: ${balance.amount} ${balance.symbol}`)
          if (balance.fiatValue && balance.fiatCurrency) {
            console.log(
              `  Value:  ${balance.fiatValue.toFixed(2)} ${balance.fiatCurrency}`
            )
          }
        } else {
          // Show all balances
          const balances = await vaultManager.getAllBalances(options.tokens)

          spinner.succeed('Balances loaded')

          console.log(chalk.cyan('\nPortfolio Balances:\n'))

          const tableData = Object.entries(balances).map(
            ([chain, balance]) => ({
              Chain: chain,
              Amount: balance.amount,
              Symbol: balance.symbol,
              Value:
                balance.fiatValue && balance.fiatCurrency
                  ? `${balance.fiatValue.toFixed(2)} ${balance.fiatCurrency}`
                  : 'N/A',
            })
          )

          console.table(tableData)
        }
      }
    )
  )

// Command: Send transaction
program
  .command('send <chain> <to> <amount>')
  .description('Send tokens to an address')
  .option('--token <tokenId>', 'Token to send (default: native)')
  .option('--memo <memo>', 'Transaction memo')
  .action(
    withExit(
      async (
        chainStr: string,
        to: string,
        amount: string,
        options: { token?: string; memo?: string }
      ) => {
        await init()

        if (!vaultManager.getActiveVault()) {
          throw new Error('No active vault. Create or import a vault first.')
        }

        if (!transactionManager) {
          throw new Error('Transaction manager not initialized')
        }

        // Validate inputs
        const chain = chainStr as Chain
        if (!Object.values(Chain).includes(chain)) {
          throw new Error(`Invalid chain: ${chain}`)
        }

        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          throw new Error('Invalid amount')
        }

        // Execute send (password will be prompted via GlobalConfig.onPasswordRequired)
        try {
          const result = await transactionManager.send({
            chain,
            to,
            amount,
            tokenId: options.token,
            memo: options.memo,
          })

          // Display result
          console.log(chalk.green('\n✓ Transaction successful!'))
          console.log(chalk.blue(`\nTransaction Hash: ${result.txHash}`))
          console.log(chalk.cyan(`View on explorer: ${result.explorerUrl}`))
        } catch (error: any) {
          if (error.message === 'Transaction cancelled by user') {
            console.log(chalk.yellow('\n✗ Transaction cancelled'))
            return // Exit cleanly
          }
          throw error
        }
      }
    )
  )

// Command: Show portfolio value
program
  .command('portfolio')
  .description('Show total portfolio value')
  .option(
    '-c, --currency <currency>',
    `Fiat currency (${fiatCurrencies.join(', ')})`,
    'usd'
  )
  .action(
    withExit(async (options: { currency: string }) => {
      await init()

      if (!vaultManager.getActiveVault()) {
        throw new Error('No active vault. Create or import a vault first.')
      }

      const vault = vaultManager.getActiveVault()!

      // Validate and normalize currency
      const currency = options.currency.toLowerCase() as FiatCurrency
      if (!fiatCurrencies.includes(currency)) {
        console.error(chalk.red(`✗ Invalid currency: ${options.currency}`))
        console.log(
          chalk.yellow(`Supported currencies: ${fiatCurrencies.join(', ')}`)
        )
        const error: any = new Error('Invalid currency')
        error.exitCode = 1
        throw error
      }

      // Persist currency preference
      if (vault.currency !== currency) {
        await vault.setCurrency(currency)
      }

      const currencyName = fiatCurrencyNameRecord[currency]
      const spinner = ora(`Loading portfolio in ${currencyName}...`).start()

      const portfolio = await vaultManager.getPortfolioValue(currency)

      spinner.succeed('Portfolio loaded')

      // Display total value
      console.log(chalk.cyan('\n╔════════════════════════════════════════╗'))
      console.log(
        chalk.cyan(`║       Portfolio Total Value (${currencyName})       ║`)
      )
      console.log(chalk.cyan('╠════════════════════════════════════════╣'))
      const totalDisplay =
        portfolio.totalValue.amount.padEnd(20) +
        portfolio.totalValue.currency.toUpperCase().padStart(16)
      console.log(
        chalk.cyan('║  ') + chalk.bold.green(totalDisplay) + chalk.cyan('  ║')
      )
      console.log(chalk.cyan('╚════════════════════════════════════════╝\n'))

      // Display breakdown by chain
      console.log(chalk.bold('Chain Breakdown:\n'))

      const table = portfolio.chainBalances.map(
        ({ chain, balance, value }) => ({
          Chain: chain,
          Amount: balance.amount,
          Symbol: balance.symbol,
          Value: value
            ? `${value.amount} ${value.currency.toUpperCase()}`
            : 'N/A',
        })
      )

      console.table(table)
    })
  )

// Command: Manage currency
program
  .command('currency [newCurrency]')
  .description('View or set the vault currency preference')
  .action(
    withExit(async (newCurrency?: string) => {
      await init()

      if (!vaultManager.getActiveVault()) {
        throw new Error('No active vault. Create or import a vault first.')
      }

      const vault = vaultManager.getActiveVault()!

      if (!newCurrency) {
        // Show current currency
        const currentCurrency = vault.currency
        const currencyName = fiatCurrencyNameRecord[currentCurrency]
        console.log(chalk.cyan('\nCurrent Currency Preference:'))
        console.log(
          `  ${chalk.green(currentCurrency.toUpperCase())} - ${currencyName}`
        )
        console.log(
          chalk.gray(`\nSupported currencies: ${fiatCurrencies.join(', ')}`)
        )
        console.log(
          chalk.gray('Use "npm run wallet currency <code>" to change')
        )
      } else {
        // Set new currency
        const currency = newCurrency.toLowerCase() as FiatCurrency
        if (!fiatCurrencies.includes(currency)) {
          console.error(chalk.red(`✗ Invalid currency: ${newCurrency}`))
          console.log(
            chalk.yellow(`Supported currencies: ${fiatCurrencies.join(', ')}`)
          )
          const error: any = new Error('Invalid currency')
          error.exitCode = 1
          throw error
        }

        const spinner = ora('Updating currency preference...').start()
        await vault.setCurrency(currency)
        spinner.succeed('Currency updated')

        const currencyName = fiatCurrencyNameRecord[currency]
        console.log(
          chalk.green(
            `\n✓ Currency preference set to ${currency.toUpperCase()} (${currencyName})`
          )
        )
      }
    })
  )

// Command: Server status
program
  .command('server')
  .description('Check server connectivity and status')
  .action(
    withExit(async () => {
      await init()

      const spinner = ora('Checking server status...').start()

      try {
        const status = await vaultManager.getSDK().getServerStatus()
        spinner.succeed('Server status retrieved')

        console.log(chalk.cyan('\nServer Status:\n'))
        console.log(
          `  Connected:     ${status.isConnected ? chalk.green('Yes') : chalk.red('No')}`
        )
        console.log(`  Endpoint:      ${status.endpoint}`)
        if (status.version) {
          console.log(`  Version:       ${status.version}`)
        }
        if (status.latency) {
          console.log(`  Latency:       ${status.latency}ms`)
        }
      } catch (error: any) {
        spinner.fail('Failed to check server status')
        console.error(chalk.red(`\n✗ ${error.message}`))
      }
    })
  )

// Command: Export vault
program
  .command('export [path]')
  .description('Export vault to file')
  .action(
    withExit(async (path?: string) => {
      await init()

      if (!vaultManager.getActiveVault()) {
        throw new Error('No active vault. Create or import a vault first.')
      }

      const { encrypt } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'encrypt',
          message: 'Encrypt export with password?',
          default: true,
        },
      ])

      let password: string | undefined
      if (encrypt) {
        const answer = await inquirer.prompt([
          {
            type: 'password',
            name: 'password',
            message: 'Enter password:',
            mask: '*',
          },
        ])
        password = answer.password
      }

      const fileName = await vaultManager.exportVault(path, password)

      console.log(chalk.green('\n✓ Vault exported successfully!'))
      console.log(chalk.blue(`File: ${fileName}`))
    })
  )

// Command: Show addresses
program
  .command('addresses')
  .description('Show all vault addresses')
  .action(
    withExit(async () => {
      await init()

      if (!vaultManager.getActiveVault()) {
        throw new Error('No active vault. Create or import a vault first.')
      }

      const spinner = ora('Loading addresses...').start()

      const addresses = await vaultManager.getAddresses()

      spinner.succeed('Addresses loaded')

      console.log(chalk.cyan('\nVault Addresses:\n'))

      const table = Object.entries(addresses).map(([chain, address]) => ({
        Chain: chain,
        Address: address,
      }))

      console.table(table)
    })
  )

// Command: Manage address book
program
  .command('address-book')
  .description('Manage address book entries')
  .option('--add', 'Add a new address book entry')
  .option('--remove <address>', 'Remove an address from the address book')
  .option('--chain <chain>', 'Filter by chain')
  .action(
    withExit(
      async (options: { add?: boolean; remove?: string; chain?: string }) => {
        await init()

        const sdk = vaultManager.getSDK()

        if (options.add) {
          // Add new address book entry
          const answers = await inquirer.prompt([
            {
              type: 'list',
              name: 'chain',
              message: 'Select chain:',
              choices: Object.values(Chain),
            },
            {
              type: 'input',
              name: 'address',
              message: 'Enter address:',
              validate: (input: string) =>
                input.trim() !== '' || 'Address is required',
            },
            {
              type: 'input',
              name: 'name',
              message: 'Enter name/label:',
              validate: (input: string) =>
                input.trim() !== '' || 'Name is required',
            },
          ])

          const spinner = ora('Adding address to address book...').start()
          await sdk.addAddressBookEntry([
            {
              chain: answers.chain,
              address: answers.address.trim(),
              name: answers.name.trim(),
            },
          ])
          spinner.succeed('Address added')

          console.log(
            chalk.green(
              `\n✓ Added ${answers.name} (${answers.chain}: ${answers.address})`
            )
          )
        } else if (options.remove) {
          // Remove address book entry
          const chain = options.chain as Chain | undefined

          const spinner = ora('Removing address from address book...').start()
          await sdk.removeAddressBookEntry([{ address: options.remove, chain }])
          spinner.succeed('Address removed')

          console.log(chalk.green(`\n✓ Removed ${options.remove}`))
        } else {
          // List address book entries
          const spinner = ora('Loading address book...').start()
          const chain = options.chain as Chain | undefined
          const entries = await sdk.getAddressBook(chain)
          spinner.succeed('Address book loaded')

          if (entries.length === 0) {
            console.log(
              chalk.yellow(
                `\nNo addresses in address book${chain ? ` for ${chain}` : ''}`
              )
            )
            console.log(
              chalk.gray('\nUse --add to add an address to the address book')
            )
          } else {
            console.log(
              chalk.cyan(`\nAddress Book${chain ? ` (${chain})` : ''}:\n`)
            )

            const table = entries.map(entry => ({
              Name: entry.name,
              Chain: entry.chain,
              Address: entry.address,
            }))

            console.table(table)

            console.log(
              chalk.gray(
                '\nUse --add to add or --remove <address> to remove an address'
              )
            )
          }
        }
      }
    )
  )

// Command: Manage chains
program
  .command('chains')
  .description('List and manage chains')
  .option('--add <chain>', 'Add a chain')
  .option('--remove <chain>', 'Remove a chain')
  .action(
    withExit(async (options: { add?: string; remove?: string }) => {
      await init()

      if (!vaultManager.getActiveVault()) {
        throw new Error('No active vault. Create or import a vault first.')
      }

      const vault = vaultManager.getActiveVault()!

      if (options.add) {
        const chain = options.add as Chain
        await vaultManager.addChain(chain)
        console.log(chalk.green(`\n✓ Added chain: ${chain}`))
        const address = await vault.address(chain)
        console.log(chalk.blue(`Address: ${address}`))
      } else if (options.remove) {
        const chain = options.remove as Chain
        await vaultManager.removeChain(chain)
        console.log(chalk.green(`\n✓ Removed chain: ${chain}`))
      } else {
        // List all chains
        const chains = vault.getChains()
        console.log(chalk.cyan('\nActive Chains:\n'))
        chains.forEach((chain: Chain) => {
          console.log(`  • ${chain}`)
        })
        console.log(
          chalk.gray(
            '\nUse --add <chain> to add a chain or --remove <chain> to remove one'
          )
        )
      }
    })
  )

// Command: List all vaults
program
  .command('vaults')
  .description('List all stored vaults')
  .action(
    withExit(async () => {
      await init()

      const spinner = ora('Loading vaults...').start()
      const vaults = await vaultManager.getSDK().listVaults()
      spinner.succeed('Vaults loaded')

      if (vaults.length === 0) {
        console.log(
          chalk.yellow('\nNo vaults found. Create or import a vault first.')
        )
        return
      }

      const activeVault = vaultManager.getActiveVault()

      console.log(chalk.cyan('\nStored Vaults:\n'))

      const table = vaults.map(vault => ({
        ID: vault.id,
        Name:
          vault.name === activeVault?.name
            ? chalk.green(`${vault.name} (active)`)
            : vault.name,
        Type: vault.type,
        Chains: vault.getChains().length,
        Created: new Date(vault.createdAt).toLocaleDateString(),
      }))

      console.table(table)

      console.log(
        chalk.gray('\nUse "npm run wallet switch <id>" to switch active vault')
      )
    })
  )

// Command: Switch active vault
program
  .command('switch <vaultId>')
  .description('Switch to a different vault')
  .action(
    withExit(async (vaultId: string) => {
      await init()

      const spinner = ora('Loading vault...').start()
      const vault = await vaultManager.getSDK().getVaultById(vaultId)

      if (!vault) {
        spinner.fail('Vault not found')
        throw new Error(`No vault found with ID: ${vaultId}`)
      }

      await vaultManager.getSDK().setActiveVault(vault)
      spinner.succeed('Vault switched')

      console.log(chalk.green(`\n✓ Switched to vault: ${vault.name}`))
      console.log(chalk.blue(`  Type: ${vault.type}`))
      console.log(chalk.blue(`  Chains: ${vault.getChains().length}`))
    })
  )

// Command: Rename vault
program
  .command('rename <newName>')
  .description('Rename the active vault')
  .action(
    withExit(async (newName: string) => {
      await init()

      if (!vaultManager.getActiveVault()) {
        throw new Error('No active vault. Create or import a vault first.')
      }

      const vault = vaultManager.getActiveVault()!
      const oldName = vault.name

      const spinner = ora('Renaming vault...').start()
      await vault.rename(newName)
      spinner.succeed('Vault renamed')

      console.log(
        chalk.green(`\n✓ Vault renamed from "${oldName}" to "${newName}"`)
      )
    })
  )

// Command: Show vault info
program
  .command('info')
  .description('Show detailed vault information')
  .action(
    withExit(async () => {
      await init()

      if (!vaultManager.getActiveVault()) {
        throw new Error('No active vault. Create or import a vault first.')
      }

      const vault = vaultManager.getActiveVault()!

      console.log(chalk.cyan('\n╔════════════════════════════════════════╗'))
      console.log(chalk.cyan('║           Vault Information            ║'))
      console.log(chalk.cyan('╚════════════════════════════════════════╝\n'))

      // Basic info
      console.log(chalk.bold('Basic Information:'))
      console.log(`  Name:          ${chalk.green(vault.name)}`)
      console.log(`  ID:            ${vault.id}`)
      console.log(`  Type:          ${chalk.yellow(vault.type)}`)
      console.log(
        `  Created:       ${new Date(vault.createdAt).toLocaleString()}`
      )
      console.log(
        `  Last Modified: ${new Date(vault.lastModified).toLocaleString()}`
      )

      // Security info
      console.log(chalk.bold('\nSecurity:'))
      console.log(
        `  Encrypted:     ${vault.isEncrypted ? chalk.green('Yes') : chalk.gray('No')}`
      )
      console.log(
        `  Backed Up:     ${vault.isBackedUp ? chalk.green('Yes') : chalk.yellow('No')}`
      )

      // MPC info
      console.log(chalk.bold('\nMPC Configuration:'))
      console.log(`  Library Type:  ${vault.libType}`)
      console.log(
        `  Threshold:     ${chalk.cyan(vault.threshold)} of ${chalk.cyan(vault.totalSigners)}`
      )
      console.log(`  Local Party:   ${vault.localPartyId}`)
      console.log(`  Total Signers: ${vault.totalSigners}`)

      // Signing modes
      const modes = vault.availableSigningModes
      console.log(chalk.bold('\nSigning Modes:'))
      modes.forEach(mode => {
        console.log(`  • ${mode}`)
      })

      // Chains
      const chains = vault.getChains()
      console.log(chalk.bold('\nChains:'))
      console.log(`  Total: ${chains.length}`)
      chains.forEach((chain: Chain) => {
        console.log(`  • ${chain}`)
      })

      // Currency
      console.log(chalk.bold('\nPreferences:'))
      console.log(`  Currency:      ${vault.currency.toUpperCase()}`)

      // Public keys
      console.log(chalk.bold('\nPublic Keys:'))
      console.log(
        `  ECDSA:         ${vault.publicKeys.ecdsa.substring(0, 20)}...`
      )
      console.log(
        `  EdDSA:         ${vault.publicKeys.eddsa.substring(0, 20)}...`
      )
      console.log(
        `  Chain Code:    ${vault.hexChainCode.substring(0, 20)}...\n`
      )
    })
  )

// Command: Manage tokens
program
  .command('tokens <chain>')
  .description('List and manage tokens for a chain')
  .option('--add <contractAddress>', 'Add a token by contract address')
  .option('--remove <tokenId>', 'Remove a token by ID')
  .action(
    withExit(
      async (chainStr: string, options: { add?: string; remove?: string }) => {
        await init()

        if (!vaultManager.getActiveVault()) {
          throw new Error('No active vault. Create or import a vault first.')
        }

        const vault = vaultManager.getActiveVault()!
        const chain = chainStr as Chain

        if (options.add) {
          // Add token by contract address
          const { symbol, decimals } = await inquirer.prompt([
            {
              type: 'input',
              name: 'symbol',
              message: 'Enter token symbol (e.g., USDT):',
              validate: (input: string) =>
                input.trim() !== '' || 'Symbol is required',
            },
            {
              type: 'number',
              name: 'decimals',
              message: 'Enter token decimals:',
              default: 18,
              validate: (input: number) =>
                input >= 0 || 'Decimals must be non-negative',
            },
          ])

          await vaultManager.addToken(chain, {
            contractAddress: options.add,
            symbol: symbol.trim(),
            decimals,
            isNativeToken: false,
          })

          console.log(chalk.green(`\n✓ Added token ${symbol} on ${chain}`))
        } else if (options.remove) {
          // Remove token
          await vaultManager.removeToken(chain, options.remove)
          console.log(
            chalk.green(`\n✓ Removed token ${options.remove} from ${chain}`)
          )
        } else {
          // List tokens for chain
          const spinner = ora(`Loading tokens for ${chain}...`).start()
          const tokens = vault.getTokens(chain)
          spinner.succeed(`Tokens loaded for ${chain}`)

          if (!tokens || tokens.length === 0) {
            console.log(chalk.yellow(`\nNo tokens configured for ${chain}`))
            console.log(
              chalk.gray(`\nUse --add <contractAddress> to add a token`)
            )
          } else {
            console.log(chalk.cyan(`\nTokens for ${chain}:\n`))
            const table = tokens.map(token => ({
              Symbol: token.symbol,
              Contract: token.contractAddress,
              Decimals: token.decimals,
              Native: token.isNativeToken ? 'Yes' : 'No',
            }))
            console.table(table)
            console.log(
              chalk.gray(
                `\nUse --add <contractAddress> to add or --remove <tokenId> to remove`
              )
            )
          }
        }
      }
    )
  )

// Cleanup on exit
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nShutting down...'))
  process.exit(0)
})

// Parse arguments
program.parse()
