#!/usr/bin/env node

import { Command } from 'commander'
import { InitCommand } from './commands/InitCommand'
import { ListCommand } from './commands/ListCommand'
import { RunCommand } from './commands/RunCommand'
import { StatusCommand } from './commands/StatusCommand'
import { AddressCommand } from './commands/AddressCommand'
import { SignCommand } from './commands/SignCommand'
import { QuitCommand } from './commands/QuitCommand'
import { VersionCommand } from './commands/VersionCommand'

const program = new Command()

program
  .name('vultisig')
  .description('Vultisig CLI - Multi-Party Computation wallet')
  .version('1.0.0')

// Register all commands
const initCommand = new InitCommand()
const listCommand = new ListCommand()
const runCommand = new RunCommand()
const statusCommand = new StatusCommand()
const addressCommand = new AddressCommand()
const signCommand = new SignCommand()
const quitCommand = new QuitCommand()
const versionCommand = new VersionCommand()

// Init command
program
  .command('init')
  .description(initCommand.description)
  .action(async () => {
    try {
      await initCommand.run()
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// List command
program
  .command('list')
  .description(listCommand.description)
  .action(async () => {
    try {
      await listCommand.run()
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Run command
program
  .command('run')
  .description(runCommand.description)
  .option('--vault <path>', 'Path to keyshare file (.vult)')
  .option('--password <password>', 'Password for encrypted keyshares')
  .option('--config <config>', 'Custom configuration file')
  .action(async (options) => {
    try {
      await runCommand.run(options)
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Status command
program
  .command('status')
  .description(statusCommand.description)
  .action(async () => {
    try {
      await statusCommand.run()
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Address command
program
  .command('address')
  .description(addressCommand.description)
  .option('--network <networks>', 'Networks (all, or comma-separated: btc,eth,sol)', 'all')
  .action(async (options) => {
    try {
      await addressCommand.run(options)
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Sign command
program
  .command('sign')
  .description(signCommand.description)
  .requiredOption('--network <network>', 'Blockchain network (ETH, BTC, SOL, etc.)')
  .option('--mode <mode>', 'Signing mode: local or relay', 'relay')
  .option('--session-id <id>', 'Custom session ID')
  .option('--payload-file <file>', 'Transaction payload JSON file')
  .option('--fast', 'Use fast mode with VultiServer (requires --password)')
  .option('--password <password>', 'VultiServer decryption password (required for --fast mode)')
  .action(async (options) => {
    try {
      await signCommand.run(options)
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Quit command
program
  .command('quit')
  .description(quitCommand.description)
  .action(async () => {
    try {
      await quitCommand.run()
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Version command
program
  .command('version')
  .description(versionCommand.description)
  .action(async () => {
    try {
      await versionCommand.run()
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

// Parse command line arguments
program.parse()