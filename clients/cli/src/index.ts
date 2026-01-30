#!/usr/bin/env node
import 'dotenv/config'

import type { FiatCurrency, VaultBase } from '@vultisig/sdk'
import { Chain, parseKeygenQR, Vultisig } from '@vultisig/sdk'
import chalk from 'chalk'
import { program } from 'commander'
import { promises as fs } from 'fs'
import inquirer from 'inquirer'

import { CLIContext, withExit } from './adapters'
import {
  executeAddressBook,
  executeAddresses,
  executeBalance,
  executeBroadcast,
  executeChains,
  executeCreateFast,
  executeCreateFromSeedphraseFast,
  executeCreateFromSeedphraseSecure,
  executeCreateSecure,
  executeCurrency,
  executeExport,
  executeImport,
  executeInfo,
  executeJoinSecure,
  executePortfolio,
  executeRename,
  executeSend,
  executeExecute,
  executeServer,
  executeSignBytes,
  executeSwap,
  executeSwapChains,
  executeSwapQuote,
  executeSwitch,
  executeTokens,
  executeVaults,
  executeVerify,
  executeRujiraBalance,
  executeRujiraDeposit,
  executeRujiraRoutes,
  executeRujiraSwap,
  executeRujiraWithdraw,
} from './commands'
import { cachePassword, createPasswordCallback } from './core'
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

async function init(vaultOverride?: string, unlockPassword?: string): Promise<CLIContext> {
  if (!ctx) {
    // Cache password BEFORE SDK init if provided
    // This allows the SDK's onPasswordRequired callback to find it
    const vaultSelector = vaultOverride || process.env.VULTISIG_VAULT
    if (unlockPassword && vaultSelector) {
      cachePassword(vaultSelector, unlockPassword)
    }

    const sdk = new Vultisig({
      onPasswordRequired: createPasswordCallback(),
    })
    await sdk.initialize()

    ctx = new CLIContext(sdk)

    // Determine which vault to use (precedence: flag > env var > stored active)
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

// Command: Create vault (with subcommands)
const createCmd = program.command('create').description('Create a vault')

// Subcommand: Create fast vault (server-assisted 2-of-2)
createCmd
  .command('fast')
  .description('Create a fast vault (server-assisted 2-of-2)')
  .requiredOption('--name <name>', 'Vault name')
  .requiredOption('--password <password>', 'Vault password')
  .requiredOption('--email <email>', 'Email for verification')
  .action(
    withExit(async (options: { name: string; password: string; email: string }) => {
      const context = await init(program.opts().vault)
      await executeCreateFast(context, options)
    })
  )

// Subcommand: Create secure vault (multi-device MPC)
createCmd
  .command('secure')
  .description('Create a secure vault (multi-device MPC)')
  .requiredOption('--name <name>', 'Vault name')
  .option('--password <password>', 'Vault password (optional)')
  .option('--threshold <m>', 'Signing threshold', '2')
  .option('--shares <n>', 'Total shares', '3')
  .action(
    withExit(async (options: { name: string; password?: string; threshold: string; shares: string }) => {
      const context = await init(program.opts().vault)
      await executeCreateSecure(context, {
        name: options.name,
        password: options.password,
        threshold: parseInt(options.threshold, 10),
        shares: parseInt(options.shares, 10),
      })
    })
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

// Command: Create vault from seedphrase (with subcommands)
const createFromSeedphraseCmd = program
  .command('create-from-seedphrase')
  .description('Create vault from BIP39 seedphrase')

/**
 * Prompt for seedphrase with secure input (masked)
 */
async function promptSeedphrase(): Promise<string> {
  info('\nEnter your 12 or 24-word recovery phrase.')
  info('Words will be hidden as you type.\n')

  const answer = await inquirer.prompt([
    {
      type: 'password',
      name: 'mnemonic',
      message: 'Seedphrase:',
      mask: '*',
      validate: (input: string) => {
        const words = input.trim().split(/\s+/)
        if (words.length !== 12 && words.length !== 24) {
          return `Expected 12 or 24 words, got ${words.length}`
        }
        return true
      },
    },
  ])

  return answer.mnemonic.trim().toLowerCase()
}

/**
 * Prompt for QR code payload from initiator device
 */
async function promptQrPayload(): Promise<string> {
  info('\nEnter the QR code payload from the initiator device.')
  info('The payload starts with "vultisig://".\n')

  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'qrPayload',
      message: 'QR Payload:',
      validate: (input: string) => {
        const trimmed = input.trim()
        if (!trimmed.startsWith('vultisig://')) {
          return 'QR payload must start with "vultisig://"'
        }
        return true
      },
    },
  ])

  return answer.qrPayload.trim()
}

// Subcommand: create-from-seedphrase fast
createFromSeedphraseCmd
  .command('fast')
  .description('Create FastVault from seedphrase (server-assisted 2-of-2)')
  .requiredOption('--name <name>', 'Vault name')
  .requiredOption('--password <password>', 'Vault password')
  .requiredOption('--email <email>', 'Email for verification')
  .option('--mnemonic <words>', 'Seedphrase (12 or 24 words, space-separated)')
  .option('--discover-chains', 'Scan chains for existing balances')
  .option('--chains <chains>', 'Specific chains to enable (comma-separated)')
  .action(
    withExit(
      async (options: {
        name: string
        password: string
        email: string
        mnemonic?: string
        discoverChains?: boolean
        chains?: string
      }) => {
        const context = await init(program.opts().vault)

        // If mnemonic not provided via flag, prompt securely
        let mnemonic = options.mnemonic
        if (!mnemonic) {
          mnemonic = await promptSeedphrase()
        }

        // Parse chains with case-insensitive lookup
        let chains: Chain[] | undefined
        if (options.chains) {
          const chainNames = options.chains.split(',').map(c => c.trim())
          chains = []
          for (const name of chainNames) {
            const chain = findChainByName(name)
            if (chain) {
              chains.push(chain)
            } else {
              console.warn(`Warning: Unknown chain "${name}" - skipping`)
            }
          }
        }

        await executeCreateFromSeedphraseFast(context, {
          mnemonic,
          name: options.name,
          password: options.password,
          email: options.email,
          discoverChains: options.discoverChains,
          chains,
        })
      }
    )
  )

// Subcommand: create-from-seedphrase secure
createFromSeedphraseCmd
  .command('secure')
  .description('Create SecureVault from seedphrase (multi-device MPC)')
  .requiredOption('--name <name>', 'Vault name')
  .option('--password <password>', 'Vault password (optional)')
  .option('--threshold <m>', 'Signing threshold', '2')
  .option('--shares <n>', 'Total shares', '3')
  .option('--mnemonic <words>', 'Seedphrase (12 or 24 words)')
  .option('--discover-chains', 'Scan chains for existing balances')
  .option('--chains <chains>', 'Specific chains to enable (comma-separated)')
  .action(
    withExit(
      async (options: {
        name: string
        password?: string
        threshold: string
        shares: string
        mnemonic?: string
        discoverChains?: boolean
        chains?: string
      }) => {
        const context = await init(program.opts().vault)

        let mnemonic = options.mnemonic
        if (!mnemonic) {
          mnemonic = await promptSeedphrase()
        }

        // Parse chains with case-insensitive lookup
        let chains: Chain[] | undefined
        if (options.chains) {
          const chainNames = options.chains.split(',').map(c => c.trim())
          chains = []
          for (const name of chainNames) {
            const chain = findChainByName(name)
            if (chain) {
              chains.push(chain)
            } else {
              console.warn(`Warning: Unknown chain "${name}" - skipping`)
            }
          }
        }

        await executeCreateFromSeedphraseSecure(context, {
          mnemonic,
          name: options.name,
          password: options.password,
          threshold: parseInt(options.threshold, 10),
          shares: parseInt(options.shares, 10),
          discoverChains: options.discoverChains,
          chains,
        })
      }
    )
  )

// Command: Join vault creation session (with subcommands)
const joinCmd = program.command('join').description('Join an existing vault creation session')

// Subcommand: join secure
joinCmd
  .command('secure')
  .description('Join a SecureVault creation session')
  .option('--qr <payload>', 'QR code payload from initiator (vultisig://...)')
  .option('--qr-file <path>', 'Read QR payload from file')
  .option('--mnemonic <words>', 'Seedphrase (required for seedphrase-based sessions)')
  .option('--password <password>', 'Vault password (optional)')
  .option('--devices <n>', 'Total devices in session', '2')
  .action(
    withExit(
      async (options: { qr?: string; qrFile?: string; mnemonic?: string; password?: string; devices: string }) => {
        const context = await init(program.opts().vault)

        // Get QR payload from flag, file, or prompt
        let qrPayload = options.qr
        if (!qrPayload && options.qrFile) {
          qrPayload = (await fs.readFile(options.qrFile, 'utf-8')).trim()
        }
        if (!qrPayload) {
          qrPayload = await promptQrPayload()
        }

        // Parse QR to check if mnemonic is needed
        const qrParams = await parseKeygenQR(qrPayload)

        let mnemonic = options.mnemonic
        if (qrParams.libType === 'KEYIMPORT' && !mnemonic) {
          // Seedphrase-based session requires mnemonic
          info('\nThis session requires a seedphrase to join.')
          mnemonic = await promptSeedphrase()
        }

        await executeJoinSecure(context, {
          qrPayload,
          mnemonic,
          password: options.password,
          devices: parseInt(options.devices, 10),
        })
      }
    )
  )

// Command: Verify vault with email code
program
  .command('verify <vaultId>')
  .description('Verify vault with email verification code')
  .option('-r, --resend', 'Resend verification email')
  .option('--code <code>', 'Verification code')
  .option('--email <email>', 'Email address (required for --resend)')
  .option('--password <password>', 'Vault password (required for --resend)')
  .action(
    withExit(
      async (vaultId: string, options: { resend?: boolean; code?: string; email?: string; password?: string }) => {
        const context = await init(program.opts().vault)
        const verified = await executeVerify(context, vaultId, options)
        if (!verified) {
          const err: any = new Error('Verification failed')
          err.exitCode = 1
          throw err
        }
      }
    )
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
  .option('--password <password>', 'Vault password for signing')
  .action(
    withExit(
      async (
        chainStr: string,
        to: string,
        amount: string,
        options: { token?: string; memo?: string; yes?: boolean; password?: string }
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
            password: options.password,
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

// Command: Execute CosmWasm contract (for Rujira FIN swaps, etc.)
program
  .command('execute <chain> <contract> <msg>')
  .description('Execute a CosmWasm smart contract (THORChain, MayaChain)')
  .option('--funds <funds>', 'Funds to send with execution (format: "denom:amount" or "denom:amount,denom2:amount2")')
  .option('--memo <memo>', 'Transaction memo')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--password <password>', 'Vault password for signing')
  .action(
    withExit(
      async (
        chainStr: string,
        contract: string,
        msg: string,
        options: { funds?: string; memo?: string; yes?: boolean; password?: string }
      ) => {
        const context = await init(program.opts().vault, options.password)
        try {
          await executeExecute(context, {
            chain: findChainByName(chainStr) || (chainStr as Chain),
            contract,
            msg,
            funds: options.funds,
            memo: options.memo,
            yes: options.yes,
            password: options.password,
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

// Command: Sign arbitrary bytes (for externally constructed transactions)
program
  .command('sign')
  .description('Sign pre-hashed bytes (for externally constructed transactions)')
  .requiredOption('--chain <chain>', 'Target blockchain')
  .requiredOption('--bytes <base64>', 'Base64-encoded pre-hashed data to sign')
  .option('--password <password>', 'Vault password for signing')
  .action(
    withExit(async (options: { chain: string; bytes: string; password?: string }) => {
      const context = await init(program.opts().vault, options.password)
      await executeSignBytes(context, {
        chain: findChainByName(options.chain) || (options.chain as Chain),
        bytes: options.bytes,
        password: options.password,
      })
    })
  )

// Command: Broadcast raw transaction
program
  .command('broadcast')
  .description('Broadcast a pre-signed raw transaction')
  .requiredOption('--chain <chain>', 'Target blockchain')
  .requiredOption('--raw-tx <hex>', 'Hex-encoded signed transaction')
  .action(
    withExit(async (options: { chain: string; rawTx: string }) => {
      const context = await init(program.opts().vault)
      await executeBroadcast(context, {
        chain: findChainByName(options.chain) || (options.chain as Chain),
        rawTx: options.rawTx,
      })
    })
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
  .option('--password <password>', 'Password to unlock the vault (for encrypted vaults)')
  .option('--exportPassword <password>', 'Password to encrypt the exported file (defaults to --password)')
  .action(
    withExit(async (path: string | undefined, options: { password?: string; exportPassword?: string }) => {
      const context = await init(program.opts().vault, options.password)
      await executeExport(context, {
        outputPath: path,
        password: options.password,
        exportPassword: options.exportPassword,
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
  .option('--password <password>', 'Vault password for signing')
  .action(
    withExit(
      async (
        fromChainStr: string,
        toChainStr: string,
        amountStr: string,
        options: { fromToken?: string; toToken?: string; slippage?: string; yes?: boolean; password?: string }
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
            password: options.password,
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
// Rujira (FIN) Commands
// ============================================================================

const rujiraCmd = program.command('rujira').description('Rujira FIN swaps + secured asset tools on THORChain')

rujiraCmd
  .command('balance')
  .description('Show secured asset balances on THORChain')
  .option('--secured-only', 'Filter to secured/FIN-like denoms only')
  .option('--network <network>', 'Network: mainnet|testnet (default: mainnet)', 'mainnet')
  .option('--rpc <url>', 'Override THORChain RPC endpoint')
  .option('--rest <url>', 'Override THORNode REST endpoint')
  .action(
    withExit(async (options: { securedOnly?: boolean; network?: string; rpc?: string; rest?: string }) => {
      const context = await init(program.opts().vault)
      await executeRujiraBalance(context, {
        securedOnly: options.securedOnly,
        network: (options.network as any) ?? 'mainnet',
        rpcEndpoint: options.rpc,
        restEndpoint: options.rest,
      })
    })
  )

rujiraCmd
  .command('routes')
  .description('List available FIN swap routes')
  .action(
    withExit(async () => {
      await executeRujiraRoutes()
    })
  )

rujiraCmd
  .command('deposit')
  .description('Show deposit instructions (inbound address + memo)')
  .option('--asset <asset>', 'L1 asset to deposit (e.g., BTC.BTC, ETH.ETH)')
  .option('--amount <amount>', 'Amount in base units (optional; used for validation)', '1')
  .option('--affiliate <thorAddress>', 'Affiliate THOR address (optional)')
  .option('--affiliate-bps <bps>', 'Affiliate fee in basis points (optional)', '0')
  .option('--network <network>', 'Network: mainnet|testnet (default: mainnet)', 'mainnet')
  .option('--rpc <url>', 'Override THORChain RPC endpoint')
  .option('--rest <url>', 'Override THORNode REST endpoint')
  .action(
    withExit(
      async (options: {
        asset?: string
        amount?: string
        affiliate?: string
        affiliateBps?: string
        network?: string
        rpc?: string
        rest?: string
      }) => {
        const context = await init(program.opts().vault)
        await executeRujiraDeposit(context, {
          asset: options.asset,
          amount: options.amount,
          affiliate: options.affiliate,
          affiliateBps: options.affiliateBps ? parseInt(options.affiliateBps, 10) : undefined,
          network: (options.network as any) ?? 'mainnet',
          rpcEndpoint: options.rpc,
          restEndpoint: options.rest,
        })
      }
    )
  )

rujiraCmd
  .command('swap <fromAsset> <toAsset> <amount>')
  .description('Execute a FIN swap (amount in base units)')
  .option('--slippage-bps <bps>', 'Slippage tolerance in basis points (default: 100 = 1%)', '100')
  .option('--destination <thorAddress>', 'Destination THOR address (default: vault THORChain address)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--password <password>', 'Vault password for signing')
  .option('--network <network>', 'Network: mainnet|testnet (default: mainnet)', 'mainnet')
  .option('--rpc <url>', 'Override THORChain RPC endpoint')
  .option('--rest <url>', 'Override THORNode REST endpoint')
  .action(
    withExit(
      async (
        fromAsset: string,
        toAsset: string,
        amount: string,
        options: {
          slippageBps?: string
          destination?: string
          yes?: boolean
          password?: string
          network?: string
          rpc?: string
          rest?: string
        }
      ) => {
        const context = await init(program.opts().vault, options.password)
        await executeRujiraSwap(context, {
          fromAsset,
          toAsset,
          amount,
          slippageBps: options.slippageBps ? parseInt(options.slippageBps, 10) : undefined,
          destination: options.destination,
          yes: options.yes,
          password: options.password,
          network: (options.network as any) ?? 'mainnet',
          rpcEndpoint: options.rpc,
          restEndpoint: options.rest,
        })
      }
    )
  )

rujiraCmd
  .command('withdraw <asset> <amount> <l1Address>')
  .description('Withdraw secured assets to L1 (amount in base units)')
  .option('--max-fee-bps <bps>', 'Max outbound fee as bps of amount (optional)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--password <password>', 'Vault password for signing')
  .option('--network <network>', 'Network: mainnet|testnet (default: mainnet)', 'mainnet')
  .option('--rpc <url>', 'Override THORChain RPC endpoint')
  .option('--rest <url>', 'Override THORNode REST endpoint')
  .action(
    withExit(
      async (
        asset: string,
        amount: string,
        l1Address: string,
        options: {
          maxFeeBps?: string
          yes?: boolean
          password?: string
          network?: string
          rpc?: string
          rest?: string
        }
      ) => {
        const context = await init(program.opts().vault, options.password)
        await executeRujiraWithdraw(context, {
          asset,
          amount,
          l1Address,
          maxFeeBps: options.maxFeeBps ? parseInt(options.maxFeeBps, 10) : undefined,
          yes: options.yes,
          password: options.password,
          network: (options.network as any) ?? 'mainnet',
          rpcEndpoint: options.rpc,
          restEndpoint: options.rest,
        })
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
  const sdk = new Vultisig({
    onPasswordRequired: createPasswordCallback(),
  })
  await sdk.initialize()

  const session = new ShellSession(sdk)
  await session.start()
}

// ============================================================================
// Cleanup & Entry Point
// ============================================================================

// Check for interactive mode before parsing commands
const isInteractiveMode = process.argv.includes('-i') || process.argv.includes('--interactive')

process.on('SIGINT', () => {
  // In interactive mode, session.ts handles SIGINT with double Ctrl+C
  if (isInteractiveMode) return
  warn('\n\nShutting down...')
  ctx?.dispose()
  process.exit(0)
})

if (isInteractiveMode) {
  startInteractiveMode().catch(err => {
    error(`Failed to start interactive mode: ${err.message}`)
    process.exit(1)
  })
} else {
  program.parse()
}
