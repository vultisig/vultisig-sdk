#!/usr/bin/env node

import { Command } from 'commander'
// SDK will be made available globally by the launcher
declare const VultisigSDK: any
import { AddressCommand } from './commands/AddressCommand'
import { InitCommand } from './commands/InitCommand'
import { ListCommand } from './commands/ListCommand'
import { QuitCommand } from './commands/QuitCommand'
import { RunCommand } from './commands/RunCommand'
import { SignCommand } from './commands/SignCommand'
import { StatusCommand } from './commands/StatusCommand'
import { VersionCommand } from './commands/VersionCommand'

const program = new Command()

program
  .name('vultisig')
  .description('Vultisig CLI - Multi-Party Computation wallet')
  .version('1.0.0')

// Initialize SDK globally for CLI operations
let sdk: any

async function initializeSDK(): Promise<void> {
  if (!sdk) {
    sdk = new VultisigSDK({
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
const initCommand = new InitCommand()
const listCommand = new ListCommand()
const runCommand = new RunCommand()
const statusCommand = new StatusCommand()
const addressCommand = new AddressCommand()
const signCommand = new SignCommand()
const quitCommand = new QuitCommand()
const versionCommand = new VersionCommand()

// Init command - doesn't need SDK
program
  .command('init')
  .description(initCommand.description)
  .action(wrapCommand(initCommand, false))

// List command - needs SDK for vault checking
program
  .command('list')
  .description(listCommand.description)
  .action(wrapCommand(listCommand, true))

// Run command - handles SDK initialization internally
program
  .command('run')
  .description(runCommand.description)
  .option('--vault <path>', 'Path to keyshare file (.vult)')
  .option('--password <password>', 'Password for encrypted keyshares')
  .option('--config <config>', 'Custom configuration file')
  .action(wrapCommand(runCommand, false)) // RunCommand initializes SDK internally

// Status command - uses daemon/SDK
program
  .command('status')
  .description(statusCommand.description)
  .action(wrapCommand(statusCommand, true))

// Address command - uses daemon/SDK
program
  .command('address')
  .description(addressCommand.description)
  .option(
    '--network <networks>',
    'Networks (all, or comma-separated: btc,eth,sol)',
    'all'
  )
  .action(wrapCommand(addressCommand, true))

// Sign command - uses daemon/SDK
program
  .command('sign')
  .description(signCommand.description)
  .requiredOption(
    '--network <network>',
    'Blockchain network (ETH, BTC, SOL, etc.)'
  )
  .option('--mode <mode>', 'Signing mode: local, relay, or fast', 'fast')
  .option('--session-id <id>', 'Custom session ID')
  .option('--payload-file <file>', 'Transaction payload JSON file')
  .option(
    '--password <password>',
    'VultiServer decryption password (required for fast mode)'
  )
  .action(wrapCommand(signCommand, true))

// Quit command - daemon operation
program
  .command('quit')
  .description(quitCommand.description)
  .action(wrapCommand(quitCommand, false))

// Version command - no SDK needed
program
  .command('version')
  .description(versionCommand.description)
  .action(wrapCommand(versionCommand, false))

// Parse command line arguments
program.parse()
