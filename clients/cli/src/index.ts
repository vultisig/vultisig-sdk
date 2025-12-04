#!/usr/bin/env node
import 'dotenv/config'

import type { FiatCurrency, VaultBase } from '@vultisig/sdk/node'
import { Chain, createVultisig, FileStorage, Vultisig } from '@vultisig/sdk/node'
import chalk from 'chalk'
import { program } from 'commander'

import { CLIContext, withExit } from './adapters'
import {
  executeAddressBook,
  executeAddresses,
  executeBalance,
  executeChains,
  executeCreate,
  executeCurrency,
  executeExport,
  executeImport,
  executeInfo,
  executePortfolio,
  executeRename,
  executeSend,
  executeServer,
  executeSwap,
  executeSwapChains,
  executeSwapQuote,
  executeSwitch,
  executeTokens,
  executeVaults,
  executeVerify,
} from './commands'
import { createPasswordCallback } from './core'
import { findChainByName } from './interactive'
import { ShellSession } from './interactive'
import {
  checkForUpdates,
  error,
  formatVersionDetailed,
  formatVersionShort,
  getUpdateCommand,
  handleCompletion,
  info,
  initOutputMode,
  printResult,
  setupCompletionCommand,
  warn,
} from './lib'
import { setupVaultEvents } from './ui'

// ============================================================================
// Handle Shell Completion (must be checked first)
// ============================================================================

// Check if this is a completion request from the shell
;(async () => {
  const handled = await handleCompletion()
  if (handled) process.exit(0)
})()

// ============================================================================
// Global State
// ============================================================================

let ctx: CLIContext

// ============================================================================
// Program Configuration
// ============================================================================

program
  .name('vultisig')
  .description('Vultisig CLI - Secure multi-party crypto wallet')
  .version(formatVersionShort(), '-v, --version', 'Show version')
  .option('--debug', 'Enable debug output')
  .option('--silent', 'Suppress informational output, show only results')
  .option('-o, --output <format>', 'Output format: table, json (default: table)', 'table')
  .option('-i, --interactive', 'Start interactive shell mode')
  .option('--vault <nameOrId>', 'Specify vault by name or ID')
  .hook('preAction', thisCommand => {
    const opts = thisCommand.opts()
    initOutputMode({ silent: opts.silent, output: opts.output })
  })

// ============================================================================
// SDK Initialization
// ============================================================================

/**
 * Find a vault by name or ID
 * Tries exact ID match, then case-insensitive name match, then partial ID prefix match
 */
async function findVaultByNameOrId(sdk: Vultisig, nameOrId: string): Promise<VaultBase | null> {
  const vaults = await sdk.listVaults()

  // Try exact ID match first
  const byId = vaults.find(v => v.id === nameOrId)
  if (byId) return byId

  // Try name match (case-insensitive)
  const byName = vaults.find(v => v.name.toLowerCase() === nameOrId.toLowerCase())
  if (byName) return byName

  // Try partial ID match (prefix)
  const byPartialId = vaults.find(v => v.id.startsWith(nameOrId))
  if (byPartialId) return byPartialId

  return null
}

async function init(vaultOverride?: string): Promise<CLIContext> {
  if (!ctx) {
    const sdk = await createVultisig({
      storage: new FileStorage(),
      onPasswordRequired: createPasswordCallback(),
    })

    ctx = new CLIContext(sdk)

    // Determine which vault to use (precedence: flag > env var > stored active)
    const vaultSelector = vaultOverride || process.env.VULTISIG_VAULT
    let vault: VaultBase | null = null

    if (vaultSelector) {
      vault = await findVaultByNameOrId(sdk, vaultSelector)
      if (!vault) {
        throw new Error(`Vault not found: "${vaultSelector}"`)
      }
    } else {
      vault = await sdk.getActiveVault()
    }

    if (vault) {
      await ctx.setActiveVault(vault)
      setupVaultEvents(vault)
    }
  }
  return ctx
}

// ============================================================================
// Commands
// ============================================================================

// Command: Create new vault
program
  .command('create')
  .description('Create a new vault')
  .option('--type <type>', 'Vault type: fast or secure', 'fast')
  .option('--name <name>', 'Vault name')
  .option('--password <password>', 'Vault password')
  .option('--email <email>', 'Email for verification (fast vault)')
  .option('--code <code>', 'Verification code (if already received)')
  .option('--threshold <m>', 'Signing threshold (secure vault)')
  .option('--shares <n>', 'Total shares (secure vault)')
  .action(
    withExit(
      async (options: {
        type: string
        name?: string
        password?: string
        email?: string
        code?: string
        threshold?: string
        shares?: string
      }) => {
        const context = await init(program.opts().vault)
        await executeCreate(context, {
          type: options.type as 'fast' | 'secure',
          name: options.name,
          password: options.password,
          email: options.email,
          code: options.code,
          threshold: options.threshold ? parseInt(options.threshold, 10) : undefined,
          shares: options.shares ? parseInt(options.shares, 10) : undefined,
        })
      }
    )
  )

// Command: Import vault from file
program
  .command('import <file>')
  .description('Import vault from .vult file')
  .action(
    withExit(async (file: string) => {
      const context = await init(program.opts().vault)
      await executeImport(context, file)
    })
  )

// Command: Verify vault with email code
program
  .command('verify <vaultId>')
  .description('Verify vault with email verification code')
  .option('-r, --resend', 'Resend verification email')
  .option('--code <code>', 'Verification code')
  .action(
    withExit(async (vaultId: string, options: { resend?: boolean; code?: string }) => {
      const context = await init(program.opts().vault)
      const verified = await executeVerify(context, vaultId, options)
      if (!verified) {
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
      const context = await init(program.opts().vault)
      await executeBalance(context, {
        chain: chainStr ? findChainByName(chainStr) || (chainStr as Chain) : undefined,
        includeTokens: options.tokens,
      })
    })
  )

// Command: Send transaction
program
  .command('send <chain> <to> <amount>')
  .description('Send tokens to an address')
  .option('--token <tokenId>', 'Token to send (default: native)')
  .option('--memo <memo>', 'Transaction memo')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(
    withExit(
      async (
        chainStr: string,
        to: string,
        amount: string,
        options: { token?: string; memo?: string; yes?: boolean }
      ) => {
        const context = await init(program.opts().vault)
        try {
          await executeSend(context, {
            chain: findChainByName(chainStr) || (chainStr as Chain),
            to,
            amount,
            tokenId: options.token,
            memo: options.memo,
            yes: options.yes,
          })
        } catch (err: any) {
          if (err.message === 'Transaction cancelled by user') {
            warn('\nx Transaction cancelled')
            return
          }
          throw err
        }
      }
    )
  )

// Command: Show portfolio value
program
  .command('portfolio')
  .description('Show total portfolio value')
  .option('-c, --currency <currency>', 'Fiat currency (usd, eur, gbp, etc.)', 'usd')
  .action(
    withExit(async (options: { currency: string }) => {
      const context = await init(program.opts().vault)
      await executePortfolio(context, { currency: options.currency.toLowerCase() as FiatCurrency })
    })
  )

// Command: Manage currency
program
  .command('currency [newCurrency]')
  .description('View or set the vault currency preference')
  .action(
    withExit(async (newCurrency?: string) => {
      const context = await init(program.opts().vault)
      await executeCurrency(context, newCurrency)
    })
  )

// Command: Server status
program
  .command('server')
  .description('Check server connectivity and status')
  .action(
    withExit(async () => {
      const context = await init(program.opts().vault)
      await executeServer(context)
    })
  )

// Command: Export vault
program
  .command('export [path]')
  .description('Export vault to file')
  .option('--encrypt', 'Encrypt the export with a password')
  .option('--no-encrypt', 'Export without encryption')
  .option('--password <password>', 'Password for encryption')
  .action(
    withExit(async (path: string | undefined, options: { encrypt?: boolean; password?: string }) => {
      const context = await init(program.opts().vault)
      await executeExport(context, {
        outputPath: path,
        encrypt: options.encrypt,
        password: options.password,
      })
    })
  )

// Command: Show addresses
program
  .command('addresses')
  .description('Show all vault addresses')
  .action(
    withExit(async () => {
      const context = await init(program.opts().vault)
      await executeAddresses(context)
    })
  )

// Command: Manage address book
program
  .command('address-book')
  .description('Manage address book entries')
  .option('--add', 'Add a new address book entry')
  .option('--remove <address>', 'Remove an address from the address book')
  .option('--chain <chain>', 'Chain for the address (for --add or --remove)')
  .option('--address <address>', 'Address to add (for --add)')
  .option('--name <name>', 'Name/label for the address (for --add)')
  .action(
    withExit(async (options: { add?: boolean; remove?: string; chain?: string; address?: string; name?: string }) => {
      const context = await init(program.opts().vault)
      await executeAddressBook(context, {
        add: options.add,
        remove: options.remove,
        chain: options.chain ? findChainByName(options.chain) || (options.chain as Chain) : undefined,
        address: options.address,
        name: options.name,
      })
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
      const context = await init(program.opts().vault)
      await executeChains(context, {
        add: options.add ? findChainByName(options.add) || (options.add as Chain) : undefined,
        remove: options.remove ? findChainByName(options.remove) || (options.remove as Chain) : undefined,
      })
    })
  )

// Command: List all vaults
program
  .command('vaults')
  .description('List all stored vaults')
  .action(
    withExit(async () => {
      const context = await init(program.opts().vault)
      await executeVaults(context)
    })
  )

// Command: Switch active vault
program
  .command('switch <vaultId>')
  .description('Switch to a different vault')
  .action(
    withExit(async (vaultId: string) => {
      const context = await init(program.opts().vault)
      await executeSwitch(context, vaultId)
    })
  )

// Command: Rename vault
program
  .command('rename <newName>')
  .description('Rename the active vault')
  .action(
    withExit(async (newName: string) => {
      const context = await init(program.opts().vault)
      await executeRename(context, newName)
    })
  )

// Command: Show vault info
program
  .command('info')
  .description('Show detailed vault information')
  .action(
    withExit(async () => {
      const context = await init(program.opts().vault)
      await executeInfo(context)
    })
  )

// Command: Manage tokens
program
  .command('tokens <chain>')
  .description('List and manage tokens for a chain')
  .option('--add <contractAddress>', 'Add a token by contract address')
  .option('--remove <tokenId>', 'Remove a token by ID')
  .option('--symbol <symbol>', 'Token symbol (for --add)')
  .option('--name <name>', 'Token name (for --add)')
  .option('--decimals <decimals>', 'Token decimals (for --add)', '18')
  .action(
    withExit(
      async (
        chainStr: string,
        options: { add?: string; remove?: string; symbol?: string; name?: string; decimals?: string }
      ) => {
        const context = await init(program.opts().vault)
        await executeTokens(context, {
          chain: findChainByName(chainStr) || (chainStr as Chain),
          add: options.add,
          remove: options.remove,
          symbol: options.symbol,
          name: options.name,
          decimals: options.decimals ? parseInt(options.decimals, 10) : undefined,
        })
      }
    )
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
      const context = await init(program.opts().vault)
      await executeSwapChains(context)
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
        const context = await init(program.opts().vault)
        await executeSwapQuote(context, {
          fromChain: findChainByName(fromChainStr) || (fromChainStr as Chain),
          toChain: findChainByName(toChainStr) || (toChainStr as Chain),
          amount: parseFloat(amountStr),
          fromToken: options.fromToken,
          toToken: options.toToken,
        })
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
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(
    withExit(
      async (
        fromChainStr: string,
        toChainStr: string,
        amountStr: string,
        options: { fromToken?: string; toToken?: string; slippage?: string; yes?: boolean }
      ) => {
        const context = await init(program.opts().vault)
        try {
          await executeSwap(context, {
            fromChain: findChainByName(fromChainStr) || (fromChainStr as Chain),
            toChain: findChainByName(toChainStr) || (toChainStr as Chain),
            amount: parseFloat(amountStr),
            fromToken: options.fromToken,
            toToken: options.toToken,
            slippage: options.slippage ? parseFloat(options.slippage) : undefined,
            yes: options.yes,
          })
        } catch (err: any) {
          if (err.message === 'Swap cancelled by user') {
            warn('\nx Swap cancelled')
            return
          }
          throw err
        }
      }
    )
  )

// ============================================================================
// CLI Management Commands
// ============================================================================

// Command: Show detailed version
program
  .command('version')
  .description('Show detailed version information')
  .action(
    withExit(async () => {
      printResult(formatVersionDetailed())

      // Check for updates
      const result = await checkForUpdates()
      if (result?.updateAvailable && result.latestVersion) {
        info('')
        info(chalk.yellow(`Update available: ${result.currentVersion} -> ${result.latestVersion}`))
        info(chalk.gray(`Run "${getUpdateCommand()}" to update`))
      }
    })
  )

// Command: Check for updates
program
  .command('update')
  .description('Check for updates and show update command')
  .option('--check', 'Just check for updates, do not update')
  .action(
    withExit(async (options: { check?: boolean }) => {
      info('Checking for updates...')
      const result = await checkForUpdates()

      if (!result) {
        printResult(chalk.gray('Update checking is disabled'))
        return
      }

      if (result.updateAvailable && result.latestVersion) {
        printResult('')
        printResult(chalk.green(`Update available: ${result.currentVersion} -> ${result.latestVersion}`))
        printResult('')

        if (options.check) {
          printResult(`Run "${getUpdateCommand()}" to update`)
        } else {
          const updateCmd = getUpdateCommand()
          printResult(`To update, run:`)
          printResult(chalk.cyan(`  ${updateCmd}`))
        }
      } else {
        printResult(chalk.green(`You're on the latest version (${result.currentVersion})`))
      }
    })
  )

// Setup completion command
setupCompletionCommand(program)

// ============================================================================
// Interactive Mode
// ============================================================================

async function startInteractiveMode(): Promise<void> {
  const sdk = await createVultisig({
    storage: new FileStorage(),
    onPasswordRequired: createPasswordCallback(),
  })

  const session = new ShellSession(sdk)
  await session.start()
}

// ============================================================================
// Cleanup & Entry Point
// ============================================================================

process.on('SIGINT', () => {
  warn('\n\nShutting down...')
  ctx?.dispose()
  process.exit(0)
})

// Check for interactive mode before parsing commands
if (process.argv.includes('-i') || process.argv.includes('--interactive')) {
  startInteractiveMode().catch(err => {
    error(`Failed to start interactive mode: ${err.message}`)
    process.exit(1)
  })
} else {
  program.parse()
}
