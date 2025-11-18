#!/usr/bin/env node
import 'dotenv/config'

import { Chain } from '@vultisig/sdk'
import chalk from 'chalk'
import { program } from 'commander'
import inquirer from 'inquirer'
import ora from 'ora'

import { TransactionManager } from './transaction'
import { VaultManager } from './wallet'

// Global state
let vaultManager: VaultManager
let transactionManager: TransactionManager

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

// Command: Create new vault
program
  .command('create')
  .description('Create a new vault')
  .action(async () => {
    try {
      await init()

      // Collect vault details
      const answers: any = await inquirer.prompt<any>([
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
        {
          type: 'input',
          name: 'email',
          message: 'Enter email for verification:',
          validate: (input: string) =>
            /\S+@\S+\.\S+/.test(input) || 'Invalid email format',
        },
      ])

      // Create vault
      const { vaultId, verificationRequired } = await vaultManager.createVault(
        answers.name,
        answers.password,
        answers.email
      )

      if (verificationRequired) {
        // Get verification code
        const { code } = await inquirer.prompt([
          {
            type: 'input',
            name: 'code',
            message: `Verification code sent to ${answers.email}. Enter code:`,
            validate: (input: string) =>
              /^\d{6}$/.test(input) || 'Code must be 6 digits',
          },
        ])

        // Verify vault
        const verified = await vaultManager.verifyVault(vaultId, code)

        if (verified) {
          console.log(chalk.green('\n✓ Vault created and verified!'))
        } else {
          console.log(
            chalk.yellow('\n⚠ Vault created but verification failed')
          )
        }
      } else {
        console.log(chalk.green('\n✓ Vault created!'))
      }

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
    } catch (error: any) {
      console.error(chalk.red(`\n✗ Failed to create vault: ${error.message}`))
      process.exit(1)
    }
  })

// Command: Import vault from file
program
  .command('import <file>')
  .description('Import vault from .vult file')
  .action(async (file: string) => {
    try {
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
    } catch (error: any) {
      console.error(chalk.red(`\n✗ Failed to import vault: ${error.message}`))
      process.exit(1)
    }
  })

// Command: Show balances
program
  .command('balance [chain]')
  .description('Show balance for a chain or all chains')
  .option('-t, --tokens', 'Include token balances')
  .action(
    async (chainStr: string | undefined, options: { tokens?: boolean }) => {
      try {
        await init()

        if (!vaultManager.getActiveVault()) {
          console.error(
            chalk.red('\n✗ No active vault. Create or import a vault first.')
          )
          process.exit(1)
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
      } catch (error: any) {
        console.error(chalk.red(`\n✗ Failed to load balance: ${error.message}`))
        process.exit(1)
      }
    }
  )

// Command: Send transaction
program
  .command('send <chain> <to> <amount>')
  .description('Send tokens to an address')
  .option('--token <tokenId>', 'Token to send (default: native)')
  .option('--memo <memo>', 'Transaction memo')
  .action(
    async (
      chainStr: string,
      to: string,
      amount: string,
      options: { token?: string; memo?: string }
    ) => {
      try {
        await init()

        if (!vaultManager.getActiveVault()) {
          console.error(
            chalk.red('\n✗ No active vault. Create or import a vault first.')
          )
          process.exit(1)
        }

        if (!transactionManager) {
          console.error(chalk.red('\n✗ Transaction manager not initialized'))
          process.exit(1)
        }

        // Validate inputs
        const chain = chainStr as Chain
        if (!Object.values(Chain).includes(chain)) {
          throw new Error(`Invalid chain: ${chain}`)
        }

        if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
          throw new Error('Invalid amount')
        }

        // Get password
        const { password } = await inquirer.prompt([
          {
            type: 'password',
            name: 'password',
            message: 'Enter vault password to sign transaction:',
            mask: '*',
          },
        ])

        // Execute send
        const result = await transactionManager.send(
          {
            chain,
            to,
            amount,
            tokenId: options.token,
            memo: options.memo,
          },
          password
        )

        // Display result
        console.log(chalk.green('\n✓ Transaction successful!'))
        console.log(chalk.blue(`\nTransaction Hash: ${result.txHash}`))
        console.log(chalk.cyan(`View on explorer: ${result.explorerUrl}`))
      } catch (error: any) {
        if (error.message === 'Transaction cancelled by user') {
          console.log(chalk.yellow('\n✗ Transaction cancelled'))
          process.exit(0)
        }
        console.error(chalk.red(`\n✗ Transaction failed: ${error.message}`))
        process.exit(1)
      }
    }
  )

// Command: Show portfolio value
program
  .command('portfolio')
  .description('Show total portfolio value')
  .option('-c, --currency <currency>', 'Fiat currency (USD, EUR, GBP)', 'USD')
  .action(async (options: { currency: string }) => {
    try {
      await init()

      if (!vaultManager.getActiveVault()) {
        console.error(
          chalk.red('\n✗ No active vault. Create or import a vault first.')
        )
        process.exit(1)
      }

      const spinner = ora('Loading portfolio...').start()

      const portfolio = await vaultManager.getPortfolioValue(options.currency)

      spinner.succeed('Portfolio loaded')

      // Display total value
      console.log(chalk.cyan('\n╔════════════════════════════════════════╗'))
      console.log(chalk.cyan('║       Portfolio Total Value            ║'))
      console.log(chalk.cyan('╠════════════════════════════════════════╣'))
      const totalDisplay =
        portfolio.totalValue.amount.padEnd(20) +
        portfolio.totalValue.currency.padStart(16)
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
          Value: value ? `${value.amount} ${value.currency}` : 'N/A',
        })
      )

      console.table(table)
    } catch (error: any) {
      console.error(chalk.red(`\n✗ Failed to load portfolio: ${error.message}`))
      process.exit(1)
    }
  })

// Command: Export vault
program
  .command('export [path]')
  .description('Export vault to file')
  .action(async (path?: string) => {
    try {
      await init()

      if (!vaultManager.getActiveVault()) {
        console.error(
          chalk.red('\n✗ No active vault. Create or import a vault first.')
        )
        process.exit(1)
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
    } catch (error: any) {
      console.error(chalk.red(`\n✗ Failed to export vault: ${error.message}`))
      process.exit(1)
    }
  })

// Command: Show addresses
program
  .command('addresses')
  .description('Show all vault addresses')
  .action(async () => {
    try {
      await init()

      if (!vaultManager.getActiveVault()) {
        console.error(
          chalk.red('\n✗ No active vault. Create or import a vault first.')
        )
        process.exit(1)
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
    } catch (error: any) {
      console.error(chalk.red(`\n✗ Failed to load addresses: ${error.message}`))
      process.exit(1)
    }
  })

// Command: Manage chains
program
  .command('chains')
  .description('List and manage chains')
  .option('--add <chain>', 'Add a chain')
  .option('--remove <chain>', 'Remove a chain')
  .action(async (options: { add?: string; remove?: string }) => {
    try {
      await init()

      if (!vaultManager.getActiveVault()) {
        console.error(
          chalk.red('\n✗ No active vault. Create or import a vault first.')
        )
        process.exit(1)
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
    } catch (error: any) {
      console.error(chalk.red(`\n✗ Operation failed: ${error.message}`))
      process.exit(1)
    }
  })

// Cleanup on exit
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nShutting down...'))
  process.exit(0)
})

// Parse arguments
program.parse()
