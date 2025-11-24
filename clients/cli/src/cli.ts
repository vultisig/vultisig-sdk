#!/usr/bin/env node

// Load environment variables first
import './utils/env'

import { Command } from 'commander'
// SDK will be made available globally by the launcher
declare const Vultisig: any
import { AddressCommand } from './commands/AddressCommand'
import { BalanceCommand } from './commands/BalanceCommand'
import { CreateCommand } from './commands/CreateCommand'
import { ListCommand } from './commands/ListCommand'
import { QuitCommand } from './commands/QuitCommand'
import { RunCommand } from './commands/RunCommand'
import { SendCommand } from './commands/SendCommand'
import { SignCommand } from './commands/SignCommand'
import { StatusCommand } from './commands/StatusCommand'
import { VerifyCommand } from './commands/VerifyCommand'
import { VersionCommand } from './commands/VersionCommand'

const program = new Command()

program.name('vultisig').description('Vultisig CLI - Multi-Party Computation wallet').version('1.0.0')

// Initialize SDK globally for CLI operations
let sdk: any

async function initializeSDK(): Promise<void> {
  if (!sdk) {
    sdk = new Vultisig({
      defaultChains: ['bitcoin', 'ethereum', 'solana'],
      defaultCurrency: 'USD',
    })

    // SDK will auto-initialize when methods are called
  }
}

// Helper function to wrap command execution with error handling
function wrapCommand(commandInstance: any, requiresSDK: boolean = false) {
  return async (options?: any) => {
    try {
      if (requiresSDK) {
        await initializeSDK()
      }

      await commandInstance.run(options)
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  }
}

// Register all commands
const createCommand = new CreateCommand()
const listCommand = new ListCommand()
const runCommand = new RunCommand()
const statusCommand = new StatusCommand()
const addressCommand = new AddressCommand()
const balanceCommand = new BalanceCommand()
const sendCommand = new SendCommand()
const signCommand = new SignCommand()
const verifyCommand = new VerifyCommand()
const quitCommand = new QuitCommand()
const versionCommand = new VersionCommand()

// Create command - needs SDK for vault creation
program
  .command('create')
  .description(createCommand.description)
  .requiredOption('--name <name>', 'Vault name')
  .option('--email <email>', 'Email for vault verification (required for fast vaults)')
  .option('--password <password>', 'Password for vault encryption')
  .option('--mode <mode>', 'Vault creation mode: fast, relay, or local', 'fast')
  .action(async options => {
    try {
      await createCommand.run(options)
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Verify command - verify fast vault with email code or check vault existence
program
  .command('verify')
  .description(verifyCommand.description)
  .requiredOption('--vault-id <vaultId>', 'Vault ID (ECDSA public key)')
  .option('--email <code>', 'Verify email code')
  .option('--password <password>', 'Check if vault exists on server (YES/NO)')
  .action(async options => {
    try {
      await verifyCommand.run(options)
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// List command - needs SDK for vault checking
program.command('list').description(listCommand.description).action(wrapCommand(listCommand, true))

// Run command - handles SDK initialization internally
program
  .command('run')
  .description(runCommand.description)
  .option('--vault <path>', 'Path to keyshare file (.vult)')
  .option('--password <password>', 'Password for encrypted keyshares')
  .option('--config <config>', 'Custom configuration file')
  .action(wrapCommand(runCommand, false)) // RunCommand initializes SDK internally

// Status command - uses daemon/SDK
program.command('status').description(statusCommand.description).action(wrapCommand(statusCommand, true))

// Address command - uses daemon/SDK
program
  .command('address')
  .description(addressCommand.description)
  .option('--network <networks>', 'Networks (all, or comma-separated: btc,eth,sol)', 'all')
  .option('--vault <path>', 'Path to keyshare file (.vult) - starts daemon if not running')
  .option('--password <password>', 'Password for encrypted keyshares')
  .action(wrapCommand(addressCommand, true))

// Balance command - uses daemon/SDK
program
  .command('balance')
  .description(balanceCommand.description)
  .option('--network <network>', 'Network to query (all, or specific: btc,eth,sol)', 'all')
  .option('--vault <path>', 'Path to keyshare file (.vult) - starts daemon if not running')
  .option('--password <password>', 'Password for encrypted keyshares')
  .action(wrapCommand(balanceCommand, true))

// Send command - uses daemon/SDK
program
  .command('send')
  .description(sendCommand.description)
  .requiredOption('--network <network>', 'Blockchain network (ETH)')
  .requiredOption('--to <address>', 'Recipient address')
  .requiredOption('--amount <amount>', 'Amount to send (in ETH)')
  .option('--memo <memo>', 'Optional transaction memo')
  .option('--vault <path>', 'Path to keyshare file (.vult) - starts daemon if not running')
  .option('--password <password>', 'Password for encrypted keyshares')
  .action(wrapCommand(sendCommand, true))

// Sign command - uses daemon/SDK
program
  .command('sign')
  .description(signCommand.description)
  .requiredOption('--network <network>', 'Blockchain network (ETH, BTC, SOL, etc.)')
  .option('--mode <mode>', 'Signing mode: local, relay, or fast', 'fast')
  .option('--session-id <id>', 'Custom session ID')
  .option('--payload-file <file>', 'Transaction payload JSON file')
  .option('--password <password>', 'VultiServer decryption password (required for fast mode)')
  .option('--vault <path>', 'Path to keyshare file (.vult) - starts daemon if not running')
  .action(wrapCommand(signCommand, true))

// Quit command - daemon operation
program.command('quit').description(quitCommand.description).action(wrapCommand(quitCommand, false))

// Version command - no SDK needed
program.command('version').description(versionCommand.description).action(wrapCommand(versionCommand, false))

// Parse command line arguments
program.parse()
