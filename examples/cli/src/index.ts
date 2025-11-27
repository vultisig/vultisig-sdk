#!/usr/bin/env node
import 'dotenv/config'

import {
  Chain,
  FastVault,
  fiatCurrencies,
  FiatCurrency,
  fiatCurrencyNameRecord,
  GlobalConfig,
  SecureVault,
  VaultBase,
  Vultisig,
} from '@vultisig/sdk'
import chalk from 'chalk'
import { program } from 'commander'
import { promises as fs } from 'fs'
import inquirer from 'inquirer'

import {
  confirmSwap,
  confirmTransaction,
  createSpinner,
  displayAddresses,
  displayBalance,
  displayBalancesTable,
  displayPortfolio,
  displaySwapChains,
  displaySwapPreview,
  displaySwapResult,
  displayTransactionPreview,
  displayTransactionResult,
  displayVaultInfo,
  displayVaultsList,
  error,
  info,
  PortfolioSummary,
  SendParams,
  setupVaultEvents,
  success,
  warn,
} from './ui'

// ============================================================================
// Global State
// ============================================================================

let sdk: Vultisig

// ============================================================================
// Password Configuration
// ============================================================================

/**
 * Parse VAULT_PASSWORDS env var into a Map
 * Format: "VaultName:password VaultId:password"
 */
function parseVaultPasswords(): Map<string, string> {
  const passwordMap = new Map<string, string>()
  const passwordsEnv = process.env.VAULT_PASSWORDS

  if (passwordsEnv) {
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

GlobalConfig.configure({
  onPasswordRequired: async (vaultId: string, vaultName?: string) => {
    const vaultPasswords = parseVaultPasswords()

    if (vaultName && vaultPasswords.has(vaultName)) {
      return vaultPasswords.get(vaultName)!
    }

    if (vaultPasswords.has(vaultId)) {
      return vaultPasswords.get(vaultId)!
    }

    if (process.env.VAULT_PASSWORD) {
      return process.env.VAULT_PASSWORD
    }

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

// ============================================================================
// SDK Initialization
// ============================================================================

async function init(): Promise<void> {
  if (!sdk) {
    const spinner = createSpinner('Initializing Vultisig SDK...')

    sdk = new Vultisig()
    await sdk.initialize()

    const existingVault = await sdk.getActiveVault()
    if (existingVault) {
      setupVaultEvents(existingVault)
      spinner.succeed(`SDK initialized - Vault loaded: ${existingVault.name}`)
    } else {
      spinner.succeed('SDK initialized')
    }
  }
}

async function ensureActiveVault(): Promise<VaultBase> {
  await init()
  const vault = await sdk.getActiveVault()
  if (!vault) {
    throw new Error('No active vault. Create or import a vault first.')
  }
  return vault
}

// ============================================================================
// Command Wrapper
// ============================================================================

function withExit(handler: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await handler(...args)
      process.exit(0)
    } catch (err: any) {
      if (err.exitCode !== undefined) {
        process.exit(err.exitCode)
      }
      console.error(chalk.red(`\nx ${err.message}`))
      process.exit(1)
    }
  }
}

// ============================================================================
// Transaction Helper
// ============================================================================

async function sendTransaction(vault: VaultBase, params: SendParams): Promise<void> {
  // 1. Prepare transaction
  const prepareSpinner = createSpinner('Preparing transaction...')

  const address = await vault.address(params.chain)
  const balance = await vault.balance(params.chain, params.tokenId)

  const coin = {
    chain: params.chain,
    address,
    decimals: balance.decimals,
    ticker: balance.symbol,
    id: params.tokenId,
  }

  const amount = BigInt(Math.floor(parseFloat(params.amount) * Math.pow(10, balance.decimals)))

  const payload = await vault.prepareSendTx({
    coin,
    receiver: params.to,
    amount,
    memo: params.memo,
  })

  prepareSpinner.succeed('Transaction prepared')

  // 2. Get gas estimate
  let gas: Awaited<ReturnType<typeof vault.gas>> | undefined
  try {
    gas = await vault.gas(params.chain)
  } catch {
    warn('\nGas estimation unavailable')
  }

  // 3. Show transaction preview
  displayTransactionPreview(
    payload.coin.address,
    params.to,
    params.amount,
    payload.coin.ticker,
    params.chain,
    params.memo,
    gas
  )

  // 4. Confirm with user
  const confirmed = await confirmTransaction()
  if (!confirmed) {
    warn('Transaction cancelled')
    throw new Error('Transaction cancelled by user')
  }

  // 5. Sign transaction
  const signSpinner = createSpinner('Signing transaction...')

  vault.on('signingProgress', ({ step }: any) => {
    signSpinner.text = `${step.message} (${step.progress}%)`
  })

  try {
    const messageHashes = await vault.extractMessageHashes(payload)

    const signature = await vault.sign({
      transaction: payload,
      chain: payload.coin.chain,
      messageHashes,
    })

    signSpinner.succeed('Transaction signed')

    // 6. Broadcast transaction
    const broadcastSpinner = createSpinner('Broadcasting transaction...')

    const txHash = await vault.broadcastTx({
      chain: params.chain,
      keysignPayload: payload,
      signature,
    })

    broadcastSpinner.succeed(`Transaction broadcast: ${txHash}`)

    // 7. Display result
    displayTransactionResult(params.chain, txHash)
  } finally {
    vault.removeAllListeners('signingProgress')
  }
}

// ============================================================================
// Commands
// ============================================================================

// Command: Create new vault
program
  .command('create')
  .description('Create a new vault')
  .option('--type <type>', 'Vault type: fast or secure', 'fast')
  .action(
    withExit(async (options: { type: string }) => {
      await init()

      const vaultType = options.type.toLowerCase()
      if (vaultType !== 'fast' && vaultType !== 'secure') {
        throw new Error('Invalid vault type. Must be "fast" or "secure"')
      }

      const answers = (await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Enter vault name:',
          validate: (input: string) => input.trim() !== '' || 'Name is required',
        },
        {
          type: 'password',
          name: 'password',
          message: 'Enter password:',
          mask: '*',
          validate: (input: string) => input.length >= 8 || 'Password must be at least 8 characters',
        },
        {
          type: 'password',
          name: 'confirmPassword',
          message: 'Confirm password:',
          mask: '*',
          validate: (input: string, ans: any) => input === ans.password || 'Passwords do not match',
        },
      ])) as any

      if (vaultType === 'fast') {
        const { email } = await inquirer.prompt([
          {
            type: 'input',
            name: 'email',
            message: 'Enter email for verification:',
            validate: (input: string) => /\S+@\S+\.\S+/.test(input) || 'Invalid email format',
          },
        ])

        const spinner = createSpinner('Creating vault...')

        const result = await FastVault.create({
          name: answers.name,
          password: answers.password,
          email,
          onProgress: step => {
            spinner.text = `${step.message} (${step.progress}%)`
          },
        })

        setupVaultEvents(result.vault)
        spinner.succeed(`Vault created: ${answers.name}`)

        if (result.verificationRequired) {
          warn('\nA verification code has been sent to your email.')
          info('Please check your inbox and enter the code.')

          const { code } = await inquirer.prompt([
            {
              type: 'input',
              name: 'code',
              message: `Verification code sent to ${email}. Enter code:`,
              validate: (input: string) => /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
            },
          ])

          const verifySpinner = createSpinner('Verifying email code...')
          const verified = await sdk.verifyVault(result.vaultId, code)

          if (verified) {
            verifySpinner.succeed('Email verified successfully!')
          } else {
            verifySpinner.fail('Invalid verification code')
            error('\nx Verification failed. Please check the code and try again.')
            warn('\nTo retry verification, use:')
            info(`  npm run wallet verify ${result.vaultId}`)
            warn('\nTo resend the verification email:')
            info(`  npm run wallet verify ${result.vaultId} --resend`)
            const err: any = new Error('Verification failed')
            err.exitCode = 1
            throw err
          }
        }
      } else {
        const secureOptions = (await inquirer.prompt([
          {
            type: 'number',
            name: 'threshold',
            message: 'Signing threshold (m):',
            default: 2,
            validate: (input: number) => input > 0 || 'Threshold must be greater than 0',
          },
          {
            type: 'number',
            name: 'totalShares',
            message: 'Total shares (n):',
            default: 3,
            validate: (input: number, ans: any) =>
              input >= ans.threshold || `Total shares must be >= threshold (${ans.threshold})`,
          },
        ])) as any

        const spinner = createSpinner('Creating secure vault...')

        try {
          const result = await SecureVault.create({
            name: answers.name,
            password: answers.password,
            devices: secureOptions.totalShares,
            threshold: secureOptions.threshold,
            onProgress: step => {
              spinner.text = `${step.message} (${step.progress}%)`
            },
          })

          setupVaultEvents(result.vault)
          spinner.succeed(
            `Secure vault created: ${answers.name} (${secureOptions.threshold}-of-${secureOptions.totalShares})`
          )

          warn(`\nImportant: Save your vault backup file (.vult) in a secure location.`)
          warn(
            `This is a ${secureOptions.threshold}-of-${secureOptions.totalShares} vault. You'll need ${secureOptions.threshold} devices to sign transactions.`
          )
        } catch (err: any) {
          spinner.fail('Secure vault creation failed')
          if (err.message?.includes('not implemented')) {
            warn('\nSecure vault creation is not yet implemented in the SDK')
          }
          throw err
        }
      }

      success('\n+ Vault created!')
      info('\nYour vault is ready. Run the following commands:')
      console.log(chalk.cyan('  npm run wallet balance     ') + '- View balances')
      console.log(chalk.cyan('  npm run wallet addresses   ') + '- View addresses')
      console.log(chalk.cyan('  npm run wallet portfolio   ') + '- View portfolio value')
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

      const spinner = createSpinner('Importing vault...')

      const vultContent = await fs.readFile(file, 'utf-8')
      const vault = await sdk.importVault(vultContent, password || undefined)

      setupVaultEvents(vault)
      spinner.succeed(`Vault imported: ${vault.name}`)

      success('\n+ Vault imported successfully!')
      info('\nRun "npm run wallet balance" to view balances')
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

      if (options.resend) {
        const spinner = createSpinner('Resending verification email...')
        await sdk.resendVaultVerification(vaultId)
        spinner.succeed('Verification email sent!')
        info('Check your inbox for the new verification code.')
      }

      const { code } = await inquirer.prompt([
        {
          type: 'input',
          name: 'code',
          message: 'Enter verification code:',
          validate: (input: string) => /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
        },
      ])

      const spinner = createSpinner('Verifying email code...')
      const verified = await sdk.verifyVault(vaultId, code)

      if (verified) {
        spinner.succeed('Vault verified successfully!')
      } else {
        spinner.fail('Invalid verification code')
        error('\nx Verification failed. Please check the code and try again.')
        warn('\nTip: Use --resend to get a new verification code:')
        info(`  npm run wallet verify ${vaultId} --resend`)
        const err: any = new Error('Verification failed')
        err.exitCode = 1
        throw err
      }
    })
  )

// Command: Show balances
program
  .command('balance [chain]')
  .description('Show balance for a chain or all chains')
  .option('-t, --tokens', 'Include token balances')
  .action(
    withExit(async (chainStr: string | undefined, options: { tokens?: boolean }) => {
      const vault = await ensureActiveVault()

      const spinner = createSpinner('Loading balances...')

      if (chainStr) {
        const chain = chainStr as Chain
        const balance = await vault.balance(chain)

        spinner.succeed('Balance loaded')
        displayBalance(chain, balance)
      } else {
        const balances = await vault.balances(undefined, options.tokens)

        spinner.succeed('Balances loaded')
        displayBalancesTable(balances)
      }
    })
  )

// Command: Send transaction
program
  .command('send <chain> <to> <amount>')
  .description('Send tokens to an address')
  .option('--token <tokenId>', 'Token to send (default: native)')
  .option('--memo <memo>', 'Transaction memo')
  .action(
    withExit(async (chainStr: string, to: string, amount: string, options: { token?: string; memo?: string }) => {
      const vault = await ensureActiveVault()

      const chain = chainStr as Chain
      if (!Object.values(Chain).includes(chain)) {
        throw new Error(`Invalid chain: ${chain}`)
      }

      if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        throw new Error('Invalid amount')
      }

      try {
        await sendTransaction(vault, {
          chain,
          to,
          amount,
          tokenId: options.token,
          memo: options.memo,
        })
      } catch (err: any) {
        if (err.message === 'Transaction cancelled by user') {
          warn('\nx Transaction cancelled')
          return
        }
        throw err
      }
    })
  )

// Command: Show portfolio value
program
  .command('portfolio')
  .description('Show total portfolio value')
  .option('-c, --currency <currency>', `Fiat currency (${fiatCurrencies.join(', ')})`, 'usd')
  .action(
    withExit(async (options: { currency: string }) => {
      const vault = await ensureActiveVault()

      const currency = options.currency.toLowerCase() as FiatCurrency
      if (!fiatCurrencies.includes(currency)) {
        error(`x Invalid currency: ${options.currency}`)
        warn(`Supported currencies: ${fiatCurrencies.join(', ')}`)
        const err: any = new Error('Invalid currency')
        err.exitCode = 1
        throw err
      }

      if (vault.currency !== currency) {
        await vault.setCurrency(currency)
      }

      const currencyName = fiatCurrencyNameRecord[currency]
      const spinner = createSpinner(`Loading portfolio in ${currencyName}...`)

      const totalValue = await vault.getTotalValue(currency)
      const chains = vault.getChains()

      const chainBalances = await Promise.all(
        chains.map(async chain => {
          const balance = await vault.balance(chain)
          try {
            const value = await vault.getValue(chain, undefined, currency)
            return { chain, balance, value }
          } catch {
            return { chain, balance }
          }
        })
      )

      const portfolio: PortfolioSummary = { totalValue, chainBalances }

      spinner.succeed('Portfolio loaded')
      displayPortfolio(portfolio, currency)
    })
  )

// Command: Manage currency
program
  .command('currency [newCurrency]')
  .description('View or set the vault currency preference')
  .action(
    withExit(async (newCurrency?: string) => {
      const vault = await ensureActiveVault()

      if (!newCurrency) {
        const currentCurrency = vault.currency
        const currencyName = fiatCurrencyNameRecord[currentCurrency]
        console.log(chalk.cyan('\nCurrent Currency Preference:'))
        console.log(`  ${chalk.green(currentCurrency.toUpperCase())} - ${currencyName}`)
        console.log(chalk.gray(`\nSupported currencies: ${fiatCurrencies.join(', ')}`))
        console.log(chalk.gray('Use "npm run wallet currency <code>" to change'))
      } else {
        const currency = newCurrency.toLowerCase() as FiatCurrency
        if (!fiatCurrencies.includes(currency)) {
          error(`x Invalid currency: ${newCurrency}`)
          warn(`Supported currencies: ${fiatCurrencies.join(', ')}`)
          const err: any = new Error('Invalid currency')
          err.exitCode = 1
          throw err
        }

        const spinner = createSpinner('Updating currency preference...')
        await vault.setCurrency(currency)
        spinner.succeed('Currency updated')

        const currencyName = fiatCurrencyNameRecord[currency]
        success(`\n+ Currency preference set to ${currency.toUpperCase()} (${currencyName})`)
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

      const spinner = createSpinner('Checking server status...')

      try {
        const status = await sdk.getServerStatus()
        spinner.succeed('Server status retrieved')

        console.log(chalk.cyan('\nServer Status:\n'))
        console.log(chalk.bold('Fast Vault Server:'))
        console.log(`  Online:   ${status.fastVault.online ? chalk.green('Yes') : chalk.red('No')}`)
        if (status.fastVault.latency) {
          console.log(`  Latency:  ${status.fastVault.latency}ms`)
        }
        console.log(chalk.bold('\nMessage Relay:'))
        console.log(`  Online:   ${status.messageRelay.online ? chalk.green('Yes') : chalk.red('No')}`)
        if (status.messageRelay.latency) {
          console.log(`  Latency:  ${status.messageRelay.latency}ms`)
        }
      } catch (err: any) {
        spinner.fail('Failed to check server status')
        error(`\nx ${err.message}`)
      }
    })
  )

// Command: Export vault
program
  .command('export [path]')
  .description('Export vault to file')
  .action(
    withExit(async (path?: string) => {
      const vault = await ensureActiveVault()

      const { encrypt } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'encrypt',
          message: 'Encrypt export with password?',
          default: true,
        },
      ])

      if (encrypt) {
        // Note: Export password encryption would be handled by vault.export() if supported
        await inquirer.prompt([
          {
            type: 'password',
            name: 'password',
            message: 'Enter password:',
            mask: '*',
          },
        ])
      }

      const spinner = createSpinner('Exporting vault...')

      const { data: vultContent } = await vault.export()
      const fileName = path || `${vault.name}-${vault.localPartyId}-vault.vult`

      await fs.writeFile(fileName, vultContent, 'utf-8')

      spinner.succeed(`Vault exported: ${fileName}`)

      success('\n+ Vault exported successfully!')
      info(`File: ${fileName}`)
    })
  )

// Command: Show addresses
program
  .command('addresses')
  .description('Show all vault addresses')
  .action(
    withExit(async () => {
      const vault = await ensureActiveVault()

      const spinner = createSpinner('Loading addresses...')
      const addresses = await vault.addresses()

      spinner.succeed('Addresses loaded')
      displayAddresses(addresses)
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
    withExit(async (options: { add?: boolean; remove?: string; chain?: string }) => {
      await init()

      if (options.add) {
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
            validate: (input: string) => input.trim() !== '' || 'Address is required',
          },
          {
            type: 'input',
            name: 'name',
            message: 'Enter name/label:',
            validate: (input: string) => input.trim() !== '' || 'Name is required',
          },
        ])

        const spinner = createSpinner('Adding address to address book...')
        await sdk.addAddressBookEntry([
          {
            chain: answers.chain,
            address: answers.address.trim(),
            name: answers.name.trim(),
            source: 'saved' as const,
            dateAdded: Date.now(),
          },
        ])
        spinner.succeed('Address added')

        success(`\n+ Added ${answers.name} (${answers.chain}: ${answers.address})`)
      } else if (options.remove) {
        const chain = options.chain as Chain | undefined

        const spinner = createSpinner('Removing address from address book...')
        await sdk.removeAddressBookEntry([{ address: options.remove, chain }])
        spinner.succeed('Address removed')

        success(`\n+ Removed ${options.remove}`)
      } else {
        const spinner = createSpinner('Loading address book...')
        const chain = options.chain as Chain | undefined
        const addressBook = await sdk.getAddressBook(chain)
        spinner.succeed('Address book loaded')

        // Combine saved and vault addresses
        const allEntries = [...addressBook.saved, ...addressBook.vaults]

        if (allEntries.length === 0) {
          warn(`\nNo addresses in address book${chain ? ` for ${chain}` : ''}`)
          console.log(chalk.gray('\nUse --add to add an address to the address book'))
        } else {
          console.log(chalk.cyan(`\nAddress Book${chain ? ` (${chain})` : ''}:\n`))

          const table = allEntries.map(entry => ({
            Name: entry.name,
            Chain: entry.chain,
            Address: entry.address,
            Source: entry.source,
          }))

          console.table(table)

          console.log(chalk.gray('\nUse --add to add or --remove <address> to remove an address'))
        }
      }
    })
  )

// Command: Manage chains
program
  .command('chains')
  .description('List and manage chains')
  .option('--add <chain>', 'Add a chain')
  .option('--remove <chain>', 'Remove a chain')
  .action(
    withExit(async (options: { add?: string; remove?: string }) => {
      const vault = await ensureActiveVault()

      if (options.add) {
        const chain = options.add as Chain
        await vault.addChain(chain)
        success(`\n+ Added chain: ${chain}`)
        const address = await vault.address(chain)
        info(`Address: ${address}`)
      } else if (options.remove) {
        const chain = options.remove as Chain
        await vault.removeChain(chain)
        success(`\n+ Removed chain: ${chain}`)
      } else {
        const chains = vault.getChains()
        console.log(chalk.cyan('\nActive Chains:\n'))
        chains.forEach((chain: Chain) => {
          console.log(`  - ${chain}`)
        })
        console.log(chalk.gray('\nUse --add <chain> to add a chain or --remove <chain> to remove one'))
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

      const spinner = createSpinner('Loading vaults...')
      const vaults = await sdk.listVaults()
      spinner.succeed('Vaults loaded')

      if (vaults.length === 0) {
        warn('\nNo vaults found. Create or import a vault first.')
        return
      }

      const activeVault = await sdk.getActiveVault()
      displayVaultsList(vaults, activeVault)

      console.log(chalk.gray('\nUse "npm run wallet switch <id>" to switch active vault'))
    })
  )

// Command: Switch active vault
program
  .command('switch <vaultId>')
  .description('Switch to a different vault')
  .action(
    withExit(async (vaultId: string) => {
      await init()

      const spinner = createSpinner('Loading vault...')
      const vault = await sdk.getVaultById(vaultId)

      if (!vault) {
        spinner.fail('Vault not found')
        throw new Error(`No vault found with ID: ${vaultId}`)
      }

      await sdk.setActiveVault(vault)
      setupVaultEvents(vault)
      spinner.succeed('Vault switched')

      success(`\n+ Switched to vault: ${vault.name}`)
      info(`  Type: ${vault.type}`)
      info(`  Chains: ${vault.getChains().length}`)
    })
  )

// Command: Rename vault
program
  .command('rename <newName>')
  .description('Rename the active vault')
  .action(
    withExit(async (newName: string) => {
      const vault = await ensureActiveVault()

      const oldName = vault.name

      const spinner = createSpinner('Renaming vault...')
      await vault.rename(newName)
      spinner.succeed('Vault renamed')

      success(`\n+ Vault renamed from "${oldName}" to "${newName}"`)
    })
  )

// Command: Show vault info
program
  .command('info')
  .description('Show detailed vault information')
  .action(
    withExit(async () => {
      const vault = await ensureActiveVault()
      displayVaultInfo(vault)
    })
  )

// Command: Manage tokens
program
  .command('tokens <chain>')
  .description('List and manage tokens for a chain')
  .option('--add <contractAddress>', 'Add a token by contract address')
  .option('--remove <tokenId>', 'Remove a token by ID')
  .action(
    withExit(async (chainStr: string, options: { add?: string; remove?: string }) => {
      const vault = await ensureActiveVault()

      const chain = chainStr as Chain

      if (options.add) {
        const { symbol, name, decimals } = await inquirer.prompt([
          {
            type: 'input',
            name: 'symbol',
            message: 'Enter token symbol (e.g., USDT):',
            validate: (input: string) => input.trim() !== '' || 'Symbol is required',
          },
          {
            type: 'input',
            name: 'name',
            message: 'Enter token name (e.g., Tether USD):',
            validate: (input: string) => input.trim() !== '' || 'Name is required',
          },
          {
            type: 'number',
            name: 'decimals',
            message: 'Enter token decimals:',
            default: 18,
            validate: (input: number) => input >= 0 || 'Decimals must be non-negative',
          },
        ])

        await vault.addToken(chain, {
          id: `${chain}-${options.add}`,
          contractAddress: options.add,
          symbol: symbol.trim(),
          name: name.trim(),
          decimals,
          chainId: chain,
          isNative: false,
        })

        success(`\n+ Added token ${symbol} on ${chain}`)
      } else if (options.remove) {
        await vault.removeToken(chain, options.remove)
        success(`\n+ Removed token ${options.remove} from ${chain}`)
      } else {
        const spinner = createSpinner(`Loading tokens for ${chain}...`)
        const tokens = vault.getTokens(chain)
        spinner.succeed(`Tokens loaded for ${chain}`)

        if (!tokens || tokens.length === 0) {
          warn(`\nNo tokens configured for ${chain}`)
          console.log(chalk.gray(`\nUse --add <contractAddress> to add a token`))
        } else {
          console.log(chalk.cyan(`\nTokens for ${chain}:\n`))
          const table = tokens.map(token => ({
            Symbol: token.symbol,
            Name: token.name,
            Contract: token.contractAddress || 'N/A',
            Decimals: token.decimals,
            Native: token.isNative ? 'Yes' : 'No',
          }))
          console.table(table)
          console.log(chalk.gray(`\nUse --add <contractAddress> to add or --remove <tokenId> to remove`))
        }
      }
    })
  )

// ============================================================================
// Swap Commands
// ============================================================================

// Command: List supported swap chains
program
  .command('swap-chains')
  .description('List chains that support swaps')
  .action(
    withExit(async () => {
      const vault = await ensureActiveVault()

      const spinner = createSpinner('Loading supported swap chains...')
      const chains = await vault.getSupportedSwapChains()
      spinner.succeed('Swap chains loaded')

      displaySwapChains(chains)
    })
  )

// Command: Get swap quote
program
  .command('swap-quote <fromChain> <toChain> <amount>')
  .description('Get a swap quote without executing')
  .option('--from-token <address>', 'Token address to swap from (default: native)')
  .option('--to-token <address>', 'Token address to swap to (default: native)')
  .action(
    withExit(
      async (
        fromChainStr: string,
        toChainStr: string,
        amountStr: string,
        options: { fromToken?: string; toToken?: string }
      ) => {
        const vault = await ensureActiveVault()

        const fromChain = fromChainStr as Chain
        const toChain = toChainStr as Chain
        const amount = parseFloat(amountStr)

        if (isNaN(amount) || amount <= 0) {
          throw new Error('Invalid amount')
        }

        // Check swap support
        const isSupported = await vault.isSwapSupported(fromChain, toChain)
        if (!isSupported) {
          throw new Error(`Swaps from ${fromChain} to ${toChain} are not supported`)
        }

        const spinner = createSpinner('Getting swap quote...')

        const quote = await vault.getSwapQuote({
          fromCoin: { chain: fromChain, token: options.fromToken },
          toCoin: { chain: toChain, token: options.toToken },
          amount,
        })

        spinner.succeed('Quote received')

        // Get symbols for display
        const fromBalance = await vault.balance(fromChain, options.fromToken)
        const toBalance = await vault.balance(toChain, options.toToken)

        displaySwapPreview(quote, amountStr, fromBalance.symbol, toBalance.symbol)

        info('\nTo execute this swap, use the "swap" command')
      }
    )
  )

// Command: Execute swap
program
  .command('swap <fromChain> <toChain> <amount>')
  .description('Swap tokens between chains')
  .option('--from-token <address>', 'Token address to swap from (default: native)')
  .option('--to-token <address>', 'Token address to swap to (default: native)')
  .option('--slippage <percent>', 'Slippage tolerance in percent', '1')
  .action(
    withExit(
      async (
        fromChainStr: string,
        toChainStr: string,
        amountStr: string,
        options: { fromToken?: string; toToken?: string; slippage?: string }
      ) => {
        const vault = await ensureActiveVault()

        const fromChain = fromChainStr as Chain
        const toChain = toChainStr as Chain
        const amount = parseFloat(amountStr)

        if (isNaN(amount) || amount <= 0) {
          throw new Error('Invalid amount')
        }

        // Check swap support
        const isSupported = await vault.isSwapSupported(fromChain, toChain)
        if (!isSupported) {
          throw new Error(`Swaps from ${fromChain} to ${toChain} are not supported`)
        }

        // 1. Get swap quote
        const quoteSpinner = createSpinner('Getting swap quote...')

        const quote = await vault.getSwapQuote({
          fromCoin: { chain: fromChain, token: options.fromToken },
          toCoin: { chain: toChain, token: options.toToken },
          amount,
        })

        quoteSpinner.succeed('Quote received')

        // Get symbols for display
        const fromBalance = await vault.balance(fromChain, options.fromToken)
        const toBalance = await vault.balance(toChain, options.toToken)

        // 2. Display preview
        displaySwapPreview(quote, amountStr, fromBalance.symbol, toBalance.symbol)

        // 3. Confirm with user
        const confirmed = await confirmSwap()
        if (!confirmed) {
          warn('Swap cancelled')
          return
        }

        // 4. Prepare swap transaction
        const prepSpinner = createSpinner('Preparing swap transaction...')

        const { keysignPayload, approvalPayload } = await vault.prepareSwapTx({
          fromCoin: { chain: fromChain, token: options.fromToken },
          toCoin: { chain: toChain, token: options.toToken },
          amount,
          swapQuote: quote,
          autoApprove: false,
        })

        prepSpinner.succeed('Swap prepared')

        // 5. Handle approval if needed
        if (approvalPayload) {
          info('\nToken approval required before swap...')

          const approvalSpinner = createSpinner('Signing approval transaction...')

          vault.on('signingProgress', ({ step }: any) => {
            approvalSpinner.text = `Approval: ${step.message} (${step.progress}%)`
          })

          try {
            const approvalHashes = await vault.extractMessageHashes(approvalPayload)
            const approvalSig = await vault.sign({
              transaction: approvalPayload,
              chain: fromChain,
              messageHashes: approvalHashes,
            })

            approvalSpinner.succeed('Approval signed')

            const broadcastApprovalSpinner = createSpinner('Broadcasting approval...')
            const approvalTxHash = await vault.broadcastTx({
              chain: fromChain,
              keysignPayload: approvalPayload,
              signature: approvalSig,
            })

            broadcastApprovalSpinner.succeed(`Approval broadcast: ${approvalTxHash}`)
            info('Waiting for approval to confirm...')

            // Wait a bit for approval to be mined
            await new Promise(resolve => setTimeout(resolve, 5000))
          } finally {
            vault.removeAllListeners('signingProgress')
          }
        }

        // 6. Sign main swap transaction
        const signSpinner = createSpinner('Signing swap transaction...')

        vault.on('signingProgress', ({ step }: any) => {
          signSpinner.text = `${step.message} (${step.progress}%)`
        })

        try {
          const messageHashes = await vault.extractMessageHashes(keysignPayload)
          const signature = await vault.sign({
            transaction: keysignPayload,
            chain: fromChain,
            messageHashes,
          })

          signSpinner.succeed('Swap transaction signed')

          // 7. Broadcast swap
          const broadcastSpinner = createSpinner('Broadcasting swap transaction...')

          const txHash = await vault.broadcastTx({
            chain: fromChain,
            keysignPayload,
            signature,
          })

          broadcastSpinner.succeed(`Swap broadcast: ${txHash}`)

          // 8. Display result
          displaySwapResult(fromChain, toChain, txHash, quote)
        } finally {
          vault.removeAllListeners('signingProgress')
        }
      }
    )
  )

// ============================================================================
// Cleanup
// ============================================================================

process.on('SIGINT', () => {
  warn('\n\nShutting down...')
  process.exit(0)
})

program.parse()
