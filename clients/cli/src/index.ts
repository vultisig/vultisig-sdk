#!/usr/bin/env node
import 'dotenv/config'

import { promises as fs } from 'node:fs'

import { descriptions } from '@vultisig/client-shared'
import type { FiatCurrency, VaultBase } from '@vultisig/sdk'
import { Chain, parseKeygenQR, Vultisig } from '@vultisig/sdk'
import chalk from 'chalk'
import { InvalidArgumentError, program } from 'commander'
import inquirer from 'inquirer'

import { CLIContext, withExit } from './adapters'
import {
  executeAddPostQuantumKeys,
  executeAddressBook,
  executeAddresses,
  executeAgent,
  executeAgentAsk,
  executeAgentSessionsDelete,
  executeAgentSessionsList,
  executeAuthLogout,
  executeAuthSetup,
  executeAuthStatus,
  executeBalance,
  executeBroadcast,
  executeChains,
  executeCreateFast,
  executeCreateFromSeedphraseFast,
  executeCreateFromSeedphraseSecure,
  executeCreateSecure,
  executeCurrency,
  executeDelete,
  executeDiscount,
  executeExecute,
  executeExport,
  executeImport,
  executeInfo,
  executeJoinSecure,
  executePortfolio,
  executeRename,
  executeRujiraBalance,
  executeRujiraDeposit,
  executeRujiraRoutes,
  executeRujiraSwap,
  executeRujiraWithdraw,
  executeSchema,
  executeSend,
  executeServer,
  executeSignBytes,
  executeSwap,
  executeSwapChains,
  executeSwapQuote,
  executeSwitch,
  executeTokens,
  executeTxStatus,
  executeVaults,
  executeVerify,
} from './commands'
import { cachePassword, createPasswordCallback } from './core'
import { EXIT_CODE_DESCRIPTIONS } from './core/errors'
import { parseServerEndpointOverridesFromArgv, resolveServerEndpoints } from './core/server-endpoints'
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
  isJsonOutput,
  isNonInteractive,
  outputJson,
  printResult,
  requireInteractive,
  setFields,
  setNonInteractive,
  setQuiet,
  setupCompletionCommand,
  setupUserAgent,
  warn,
} from './lib'
import { setupVaultEvents } from './ui'

// Set User-Agent header on all outgoing fetch requests (must run before any SDK calls)
setupUserAgent()

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
  .option(
    '-o, --output <format>',
    'Output format: json, table (defaults to json when piped)',
    (val: string) => {
      if (!['json', 'table'].includes(val)) throw new InvalidArgumentError('Must be "json" or "table"')
      return val
    },
    process.stdout.isTTY ? 'table' : 'json'
  )
  .option('-q, --quiet', 'Strip empty/zero fields from output')
  .option('--fields <fields>', 'Comma-separated list of fields to include in output')
  .option('--non-interactive', 'Disable interactive prompts (fail instead of asking)')
  .option('--ci', 'CI/automation mode (equivalent to --output json --non-interactive --quiet)')
  .option('-i, --interactive', 'Start interactive shell mode')
  .option('--vault <nameOrId>', 'Specify vault by name or ID')
  .option('--server-url <url>', 'Base Vultisig API URL for FastVault and relay endpoints')
  .addHelpText(
    'after',
    '\nExit codes:\n' +
      Object.entries(EXIT_CODE_DESCRIPTIONS)
        .map(([k, v]) => `  ${k}  ${v}`)
        .join('\n') +
      '\n\nEnvironment variables:\n' +
      '  VAULT_PASSWORD          Vault password for signing (bypasses prompt)\n' +
      '  VULTISIG_PASSWORD       Alias for VAULT_PASSWORD\n' +
      '  VAULT_PASSWORDS         Space-separated VaultName:password pairs\n' +
      '  VULTISIG_VAULT          Default vault name or ID\n' +
      '  VULTISIG_CONFIG_DIR     Override config directory (~/.vultisig)\n' +
      '  VULTISIG_SILENT         Set to 1 for silent mode\n' +
      '  NO_COLOR                Disable colored output'
  )
  .hook('preAction', thisCommand => {
    const opts = thisCommand.opts()
    // --ci implies --output json --non-interactive --quiet
    if (opts.ci) {
      const outputExplicit = process.argv.some(a => a === '--output' || a === '-o' || a.startsWith('--output='))
      opts.output = opts.output === 'table' && !outputExplicit ? 'json' : opts.output
      opts.quiet = true
      opts.nonInteractive = true
    }
    initOutputMode({ silent: opts.silent, output: opts.output })
    setQuiet(!!opts.quiet)
    setNonInteractive(!!opts.nonInteractive)
    const fields = opts.fields as string | undefined
    setFields(
      fields
        ? fields
            .split(',')
            .map((f: string) => f.trim())
            .filter(Boolean)
        : undefined
    )
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

async function init(vaultOverride?: string, unlockPassword?: string, passwordTTL?: number): Promise<CLIContext> {
  if (!ctx) {
    // Cache password BEFORE SDK init if provided
    // This allows the SDK's onPasswordRequired callback to find it
    const vaultSelector = vaultOverride || process.env.VULTISIG_VAULT
    if (unlockPassword && vaultSelector) {
      cachePassword(vaultSelector, unlockPassword)
    }

    const globalOptions = program.opts<{
      serverUrl?: string
    }>()
    const serverEndpoints = resolveServerEndpoints(globalOptions)

    const sdk = new Vultisig({
      onPasswordRequired: createPasswordCallback(),
      ...(serverEndpoints ? { serverEndpoints } : {}),
      ...(passwordTTL !== undefined ? { passwordCache: { defaultTTL: passwordTTL } } : {}),
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
  .option('--two-step', 'Create vault without verifying OTP (verify later with "vultisig verify")')
  .addHelpText(
    'after',
    `
Examples:
  vultisig create fast --name mywallet --password secret --email me@example.com
  vultisig create fast --name mywallet --password secret --email me@example.com --two-step

See also: verify, auth setup`
  )
  .action(
    withExit(async (options: { name: string; password: string; email: string; twoStep?: boolean }) => {
      const context = await init(program.opts().vault)
      await executeCreateFast(context, { ...options, twoStep: options.twoStep })
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

// Command: Add ML-DSA post-quantum keys to active fast vault
program
  .command('add-mldsa')
  .description('Add ML-DSA (post-quantum) keys to the active fast vault (VultiServer /mldsa)')
  .requiredOption('--email <email>', 'Email registered on the vault')
  .option('--password <password>', 'Vault password (otherwise prompted or from cache)')
  .action(
    withExit(async (options: { email: string; password?: string }) => {
      const context = await init(program.opts().vault)
      await executeAddPostQuantumKeys(context, {
        email: options.email,
        password: options.password,
      })
    })
  )

// Command: Import vault from file
program
  .command('import <file>')
  .description('Import vault from .vult file')
  .option('--password <password>', 'Password to decrypt the vault file')
  .addHelpText(
    'after',
    `
Examples:
  vultisig import ~/vault-backup.vult
  vultisig import ~/vault-backup.vult --password mypassword`
  )
  .action(
    withExit(async (file: string, options: { password?: string }) => {
      const context = await init(program.opts().vault)
      await executeImport(context, file, options.password)
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
  requireInteractive('Use --mnemonic flag to provide seedphrase non-interactively.')
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
  requireInteractive('Use --qr or --qr-file flag to provide QR payload non-interactively.')
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
  .option('--use-phantom-solana-path', 'Use Phantom wallet derivation path for Solana')
  .action(
    withExit(
      async (options: {
        name: string
        password: string
        email: string
        mnemonic?: string
        discoverChains?: boolean
        chains?: string
        usePhantomSolanaPath?: boolean
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
          usePhantomSolanaPath: options.usePhantomSolanaPath,
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
  .option('--use-phantom-solana-path', 'Use Phantom wallet derivation path for Solana')
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
        usePhantomSolanaPath?: boolean
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
          usePhantomSolanaPath: options.usePhantomSolanaPath,
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
  .description(descriptions.balance.description)
  .option('-t, --tokens', descriptions.balance.params.includeTokens)
  .option('--raw', 'Show raw values (wei/satoshis) for programmatic use')
  .addHelpText(
    'after',
    `
Examples:
  vultisig balance
  vultisig balance Ethereum --tokens
  vultisig balance --output json --fields chain,amount
  vultisig balance --output json -q`
  )
  .action(
    withExit(async (chainStr: string | undefined, options: { tokens?: boolean; raw?: boolean }) => {
      const context = await init(program.opts().vault)
      await executeBalance(context, {
        chain: chainStr ? findChainByName(chainStr) || (chainStr as Chain) : undefined,
        includeTokens: options.tokens,
        raw: options.raw,
      })
    })
  )

// Command: Send transaction
program
  .command('send <chain> <to> [amount]')
  .description(descriptions.send.description)
  .option('--max', 'Send maximum amount (balance minus fees)')
  .option('--token <tokenId>', 'Token to send (default: native)')
  .option('--memo <memo>', 'Transaction memo')
  .option('--dry-run', 'Preview transaction without signing or broadcasting')
  .option('--confirm', 'Confirm and broadcast (without this flag, runs as a preview)')
  .option('-y, --yes', 'Alias for --confirm')
  .option('--password <password>', 'Vault password for signing')
  .addHelpText(
    'after',
    `
Examples:
  vultisig send Ethereum 0x1234...abcd 0.1
  vultisig send Bitcoin bc1q... --max --confirm
  vultisig send Ethereum 0x... 0.5 --dry-run --output json

Environment variables:
  VAULT_PASSWORD    Vault password (bypasses prompt)
  VAULT_PASSWORDS   Space-separated VaultName:password pairs

See also: balance, tx-status`
  )
  .action(
    withExit(
      async (
        chainStr: string,
        to: string,
        amount: string | undefined,
        options: {
          max?: boolean
          token?: string
          memo?: string
          dryRun?: boolean
          yes?: boolean
          confirm?: boolean
          password?: string
        }
      ) => {
        if (!amount && !options.max) throw new Error('Provide an amount or use --max')
        if (amount && options.max) throw new Error('Cannot specify both amount and --max')
        const context = await init(program.opts().vault)
        try {
          await executeSend(context, {
            chain: findChainByName(chainStr) || (chainStr as Chain),
            to,
            amount: amount ?? 'max',
            tokenId: options.token,
            memo: options.memo,
            dryRun: options.dryRun,
            yes: options.yes || options.confirm,
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
  .option('--dry-run', 'Preview execution without signing or broadcasting')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--password <password>', 'Vault password for signing')
  .addHelpText(
    'after',
    `
Examples:
  vultisig execute THORChain <contract> '{"swap":{}}' --yes
  vultisig execute THORChain <contract> '{"deposit":{}}' --funds rune:1000000 --output json`
  )
  .action(
    withExit(
      async (
        chainStr: string,
        contract: string,
        msg: string,
        options: { funds?: string; memo?: string; dryRun?: boolean; yes?: boolean; password?: string }
      ) => {
        const context = await init(program.opts().vault, options.password)
        try {
          await executeExecute(context, {
            chain: findChainByName(chainStr) || (chainStr as Chain),
            contract,
            msg,
            funds: options.funds,
            memo: options.memo,
            dryRun: options.dryRun,
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

// Command: Check transaction status
program
  .command('tx-status')
  .description('Check the status of a transaction (polls until confirmed)')
  .requiredOption('--chain <chain>', 'Target blockchain')
  .requiredOption('--tx-hash <hash>', 'Transaction hash to check')
  .option('--no-wait', 'Return immediately without waiting for confirmation')
  .addHelpText(
    'after',
    `
Examples:
  vultisig tx-status --chain Ethereum --tx-hash 0xabc...
  vultisig tx-status --chain Bitcoin --tx-hash abc... --no-wait --output json`
  )
  .action(
    withExit(async (options: { chain: string; txHash: string; wait: boolean }) => {
      const context = await init(program.opts().vault)
      await executeTxStatus(context, {
        chain: findChainByName(options.chain) || (options.chain as Chain),
        txHash: options.txHash,
        noWait: !options.wait,
      })
    })
  )

// Command: Show portfolio value
program
  .command('portfolio')
  .description(descriptions.portfolio.description)
  .option('-c, --currency <currency>', 'Fiat currency (usd, eur, gbp, etc.)', 'usd')
  .option('--raw', 'Show raw values (wei/satoshis) for programmatic use')
  .addHelpText(
    'after',
    `
Examples:
  vultisig portfolio
  vultisig portfolio --currency eur --output json`
  )
  .action(
    withExit(async (options: { currency: string; raw?: boolean }) => {
      const context = await init(program.opts().vault)
      await executePortfolio(context, {
        currency: options.currency.toLowerCase() as FiatCurrency,
        raw: options.raw,
      })
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

// Command: Discount tier
program
  .command('discount')
  .description('Show your VULT discount tier for swap fees')
  .option('--refresh', 'Force refresh tier from blockchain')
  .action(
    withExit(async (options: { refresh?: boolean }) => {
      const context = await init(program.opts().vault)
      await executeDiscount(context, { refresh: options.refresh })
    })
  )

// Command: Export vault
program
  .command('export [path]')
  .description('Export vault to file')
  .option('--password <password>', 'Password to unlock the vault (for encrypted vaults)')
  .option('--exportPassword <password>', 'Password to encrypt the exported file (defaults to --password)')
  .addHelpText(
    'after',
    `
Examples:
  vultisig export ~/backup.vult
  vultisig export ~/backup.vult --password mypass --output json`
  )
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
  .description(descriptions.address.description)
  .addHelpText(
    'after',
    `
Examples:
  vultisig addresses
  vultisig addresses --output json --fields chain,address`
  )
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
  .option('--add-all', 'Add all supported chains')
  .option('--remove <chain>', 'Remove a chain')
  .addHelpText(
    'after',
    `
Examples:
  vultisig chains
  vultisig chains --add Solana
  vultisig chains --add-all --output json`
  )
  .action(
    withExit(async (options: { add?: string; addAll?: boolean; remove?: string }) => {
      const context = await init(program.opts().vault)
      await executeChains(context, {
        add: options.add ? findChainByName(options.add) || (options.add as Chain) : undefined,
        addAll: options.addAll,
        remove: options.remove ? findChainByName(options.remove) || (options.remove as Chain) : undefined,
      })
    })
  )

// Command: List all vaults
program
  .command('vaults')
  .description('List all stored vaults')
  .addHelpText(
    'after',
    `
Examples:
  vultisig vaults
  vultisig vaults --output json`
  )
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
  .description(descriptions.vaultInfo.description)
  .action(
    withExit(async () => {
      const context = await init(program.opts().vault)
      await executeInfo(context)
    })
  )

// Command: Delete a vault
program
  .command('delete [vault]')
  .description('Delete a vault from local storage')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(
    withExit(async (vaultIdOrName: string | undefined, options: { yes?: boolean }) => {
      const context = await init(program.opts().vault)
      await executeDelete(context, {
        vaultId: vaultIdOrName,
        skipConfirmation: options.yes,
      })
    })
  )

// Command: Manage tokens
program
  .command('tokens <chain>')
  .description('List and manage tokens for a chain')
  .option('--add <contractAddress>', 'Add a token by contract address')
  .option('--remove <tokenId>', 'Remove a token by ID')
  .option('--discover', 'Auto-discover tokens with balances on the chain')
  .addHelpText(
    'after',
    `
Examples:
  vultisig tokens Ethereum
  vultisig tokens Ethereum --discover --output json
  vultisig tokens Ethereum --add 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --symbol USDC --decimals 6`
  )
  .option('--symbol <symbol>', 'Token symbol (for --add)')
  .option('--name <name>', 'Token name (for --add)')
  .option('--decimals <decimals>', 'Token decimals (for --add)', '18')
  .action(
    withExit(
      async (
        chainStr: string,
        options: {
          add?: string
          remove?: string
          discover?: boolean
          symbol?: string
          name?: string
          decimals?: string
        }
      ) => {
        const context = await init(program.opts().vault)
        await executeTokens(context, {
          chain: findChainByName(chainStr) || (chainStr as Chain),
          add: options.add,
          remove: options.remove,
          discover: options.discover,
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
  .description(descriptions.supportedChains.description)
  .action(
    withExit(async () => {
      const context = await init(program.opts().vault)
      await executeSwapChains(context)
    })
  )

// Command: Get swap quote
program
  .command('swap-quote <fromChain> <toChain> [amount]')
  .description(descriptions.swapQuote.description)
  .option('--max', 'Swap maximum amount (full balance minus fees for native)')
  .option('--from-token <address>', 'Token address to swap from (default: native)')
  .option('--to-token <address>', 'Token address to swap to (default: native)')
  .addHelpText(
    'after',
    `
Examples:
  vultisig swap-quote Ethereum Bitcoin 0.1
  vultisig swap-quote Ethereum Bitcoin --max --output json`
  )
  .action(
    withExit(
      async (
        fromChainStr: string,
        toChainStr: string,
        amountStr: string | undefined,
        options: { max?: boolean; fromToken?: string; toToken?: string }
      ) => {
        if (!amountStr && !options.max) throw new Error('Provide an amount or use --max')
        if (amountStr && options.max) throw new Error('Cannot specify both amount and --max')
        const context = await init(program.opts().vault)
        await executeSwapQuote(context, {
          fromChain: findChainByName(fromChainStr) || (fromChainStr as Chain),
          toChain: findChainByName(toChainStr) || (toChainStr as Chain),
          amount: options.max ? 'max' : parseFloat(amountStr!),
          fromToken: options.fromToken,
          toToken: options.toToken,
        })
      }
    )
  )

// Command: Execute swap
program
  .command('swap <fromChain> <toChain> [amount]')
  .description(descriptions.swap.description)
  .option('--max', 'Swap maximum amount (full balance minus fees for native)')
  .option('--from-token <address>', 'Token address to swap from (default: native)')
  .option('--to-token <address>', 'Token address to swap to (default: native)')
  .option('--slippage <percent>', 'Slippage tolerance in percent', '1')
  .option('--dry-run', 'Preview swap without signing or broadcasting')
  .option('--confirm', 'Confirm and broadcast (without this flag, runs as a preview)')
  .option('-y, --yes', 'Alias for --confirm')
  .option('--password <password>', 'Vault password for signing')
  .addHelpText(
    'after',
    `
Examples:
  vultisig swap Ethereum Bitcoin 0.1
  vultisig swap Ethereum Bitcoin --max --confirm
  vultisig swap Ethereum Bitcoin 0.5 --dry-run --output json

See also: swap-quote, swap-chains, balance`
  )
  .action(
    withExit(
      async (
        fromChainStr: string,
        toChainStr: string,
        amountStr: string | undefined,
        options: {
          max?: boolean
          fromToken?: string
          toToken?: string
          slippage?: string
          dryRun?: boolean
          yes?: boolean
          confirm?: boolean
          password?: string
        }
      ) => {
        if (!amountStr && !options.max) throw new Error('Provide an amount or use --max')
        if (amountStr && options.max) throw new Error('Cannot specify both amount and --max')
        const context = await init(program.opts().vault)
        try {
          await executeSwap(context, {
            fromChain: findChainByName(fromChainStr) || (fromChainStr as Chain),
            toChain: findChainByName(toChainStr) || (toChainStr as Chain),
            amount: options.max ? 'max' : parseFloat(amountStr!),
            fromToken: options.fromToken,
            toToken: options.toToken,
            slippage: options.slippage ? parseFloat(options.slippage) : undefined,
            dryRun: options.dryRun,
            yes: options.yes || options.confirm,
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
  .option('--rpc <url>', 'Override THORChain RPC endpoint')
  .option('--rest <url>', 'Override THORNode REST endpoint')
  .action(
    withExit(async (options: { securedOnly?: boolean; rpc?: string; rest?: string }) => {
      const context = await init(program.opts().vault)
      await executeRujiraBalance(context, {
        securedOnly: options.securedOnly,
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
  .option('--rpc <url>', 'Override THORChain RPC endpoint')
  .option('--rest <url>', 'Override THORNode REST endpoint')
  .action(
    withExit(
      async (options: {
        asset?: string
        amount?: string
        affiliate?: string
        affiliateBps?: string
        rpc?: string
        rest?: string
      }) => {
        const context = await init(program.opts().vault)
        await executeRujiraDeposit(context, {
          asset: options.asset,
          amount: options.amount,
          affiliate: options.affiliate,
          affiliateBps: options.affiliateBps ? parseInt(options.affiliateBps, 10) : undefined,
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
  .option('--dry-run', 'Preview swap quote without executing')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--password <password>', 'Vault password for signing')
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
          dryRun?: boolean
          yes?: boolean
          password?: string
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
          dryRun: options.dryRun,
          yes: options.yes,
          password: options.password,
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
  .option('--dry-run', 'Preview withdrawal without executing')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--password <password>', 'Vault password for signing')
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
          dryRun?: boolean
          yes?: boolean
          password?: string
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
          dryRun: options.dryRun,
          yes: options.yes,
          password: options.password,
          rpcEndpoint: options.rpc,
          restEndpoint: options.rest,
        })
      }
    )
  )

// ============================================================================
// Agent Chat Command
// ============================================================================

const agentCmd = program
  .command('agent')
  .description('AI-powered chat interface for wallet operations')
  .option('--via-agent', 'Use NDJSON pipe mode for agent-to-agent communication')
  .option('--verbose', 'Show detailed tool call parameters and debug output')
  .option('--backend-url <url>', 'Agent backend URL (default: https://abe.vultisig.com)')
  .option('--password <password>', 'Vault password for signing operations')
  .option('--password-ttl <ms>', 'Password cache TTL in milliseconds (default: 300000, 86400000/24h for --via-agent)')
  .option('--session-id <id>', 'Resume an existing session')
  .option('--notification-url <url>', 'Notification service URL for push notifications')
  .action(
    async (options: {
      viaAgent?: boolean
      verbose?: boolean
      backendUrl?: string
      password?: string
      passwordTtl?: string
      sessionId?: string
      notificationUrl?: string
    }) => {
      // Resolve password TTL: explicit flag > 24h for --via-agent > default 5min
      // Note: setTimeout uses 32-bit int, so Infinity gets clamped to 1ms. Use 24h instead.
      const MAX_TTL = 86400000 // 24 hours
      let passwordTTL: number | undefined
      if (options.passwordTtl) {
        const parsed = parseInt(options.passwordTtl, 10)
        if (Number.isNaN(parsed) || parsed < 0) {
          throw new Error(
            `Invalid --password-ttl value: "${options.passwordTtl}". Expected a non-negative integer in milliseconds.`
          )
        }
        passwordTTL = parsed
      } else if (options.viaAgent) {
        passwordTTL = MAX_TTL
      }
      const context = await init(program.opts().vault, options.password, passwordTTL)
      await executeAgent(context, {
        viaAgent: options.viaAgent,
        verbose: options.verbose,
        backendUrl: options.backendUrl,
        password: options.password,
        sessionId: options.sessionId,
        notificationUrl: options.notificationUrl,
      })
    }
  )

// Ask subcommand: one-shot mode for AI coding agents
agentCmd
  .command('ask <message>')
  .description('Send a single message and get the response (for AI agent integration)')
  .option('--session <id>', 'Continue an existing conversation')
  .option('--backend-url <url>', 'Agent backend URL (default: https://abe.vultisig.com)')
  .option('--password <password>', 'Vault password for signing operations')
  .option('--verbose', 'Show tool calls and debug info on stderr')
  .option('--json', 'Output structured JSON (deprecated: use --output json)')
  .addHelpText(
    'after',
    `
Examples:
  vultisig agent ask "What is my ETH balance?" --output json
  vultisig agent ask "Send 0.1 ETH to 0x..." --session abc123 --yes`
  )
  .action(
    async (
      message: string,
      options: {
        session?: string
        backendUrl?: string
        password?: string
        verbose?: boolean
        json?: boolean
      }
    ) => {
      const parentOpts = agentCmd.opts()
      const context = await init(program.opts().vault, options.password || parentOpts.password)
      await executeAgentAsk(context, message, {
        ...options,
        backendUrl: options.backendUrl || parentOpts.backendUrl,
        password: options.password || parentOpts.password,
        verbose: options.verbose || parentOpts.verbose,
      })
    }
  )

// Session management subcommands
const sessionsCmd = agentCmd.command('sessions').description('Manage agent chat sessions')

sessionsCmd
  .command('list')
  .description('List chat sessions for the current vault')
  .option('--backend-url <url>', 'Agent backend URL (default: https://abe.vultisig.com)')
  .option('--password <password>', 'Vault password for authentication')
  .action(
    withExit(async (options: { backendUrl?: string; password?: string }) => {
      const parentOpts = agentCmd.opts()
      const context = await init(program.opts().vault, options.password || parentOpts.password)
      await executeAgentSessionsList(context, {
        backendUrl: options.backendUrl || parentOpts.backendUrl,
        password: options.password || parentOpts.password,
      })
    })
  )

sessionsCmd
  .command('delete <id>')
  .description('Delete a chat session')
  .option('--backend-url <url>', 'Agent backend URL (default: https://abe.vultisig.com)')
  .option('--password <password>', 'Vault password for authentication')
  .action(
    withExit(async (id: string, options: { backendUrl?: string; password?: string }) => {
      const parentOpts = agentCmd.opts()
      const context = await init(program.opts().vault, options.password || parentOpts.password)
      await executeAgentSessionsDelete(context, id, {
        backendUrl: options.backendUrl || parentOpts.backendUrl,
        password: options.password || parentOpts.password,
      })
    })
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

// ============================================================================
// Auth Commands (keyring credential management)
// ============================================================================

const authCmd = program.command('auth').description('Manage keyring-stored vault credentials')

authCmd
  .command('setup')
  .description('Discover .vult files, prompt for passwords, and store credentials in the OS keyring')
  .option('--vault-file <path>', 'Path to a specific .vult file')
  .option('--non-interactive', 'Fail instead of prompting (use env vars)')
  .addHelpText(
    'after',
    `
Examples:
  vultisig auth setup
  vultisig auth setup --vault-file ~/vault.vult
  VAULT_PASSWORD=secret VAULT_DECRYPT_PASSWORD=pass vultisig auth setup --non-interactive`
  )
  .action(
    withExit(async (options: { vaultFile?: string; nonInteractive?: boolean }) => {
      const result = await executeAuthSetup({
        vaultFile: options.vaultFile,
        nonInteractive: options.nonInteractive || isNonInteractive(),
      })
      if (isJsonOutput()) {
        outputJson({
          stored: true,
          vaultId: result.vaultId,
          vaultName: result.vaultName,
          storageBackend: result.storageBackend,
        })
      } else {
        printResult(
          chalk.green(`Vault "${result.vaultName}" (${result.vaultId}) credentials stored in ${result.storageBackend}.`)
        )
      }
    })
  )

authCmd
  .command('status')
  .description('List configured vaults and their keyring credential status')
  .action(
    withExit(async () => {
      const vaults = await executeAuthStatus()
      if (isJsonOutput()) {
        outputJson({
          vaults: vaults.map(v => ({ id: v.id, name: v.name, filePath: v.filePath, hasCredentials: v.hasCredentials })),
        })
        return
      }
      if (vaults.length === 0) {
        printResult('No vaults configured. Run: vsig auth setup')
        return
      }
      for (const v of vaults) {
        const status = v.hasCredentials ? chalk.green('authenticated') : chalk.red('no credentials')
        printResult(`  ${v.name} (${v.id}) - ${status}`)
        printResult(`    File: ${v.filePath}`)
      }
    })
  )

authCmd
  .command('logout')
  .description('Clear keyring credentials for a vault')
  .option('--vault-id <id>', 'Specific vault ID to clear')
  .option('--all', 'Clear credentials for all configured vaults')
  .action(
    withExit(async (options: { vaultId?: string; all?: boolean }) => {
      await executeAuthLogout({ vaultId: options.vaultId, all: options.all })
      if (isJsonOutput()) {
        outputJson({ cleared: true, vaultId: options.vaultId ?? null, all: !!options.all })
      } else {
        printResult(chalk.green('Credentials cleared.'))
      }
    })
  )

// Setup completion command
setupCompletionCommand(program)

// Schema discovery (hidden, for machine clients)
program
  .command('schema', { hidden: true })
  .description('Output machine-readable command schema (JSON introspection for agents)')
  .helpOption(false)
  .action(withExit(async () => executeSchema(program)))

// ============================================================================
// Interactive Mode
// ============================================================================

async function startInteractiveMode(): Promise<void> {
  const serverEndpoints = resolveServerEndpoints(parseServerEndpointOverridesFromArgv(process.argv.slice(2)))
  const sdk = new Vultisig({
    onPasswordRequired: createPasswordCallback(),
    ...(serverEndpoints ? { serverEndpoints } : {}),
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
