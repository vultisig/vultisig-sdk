#!/usr/bin/env node
import 'dotenv/config'

import { GlobalConfig, Vultisig } from '@vultisig/sdk'
import chalk from 'chalk'
import inquirer from 'inquirer'

import { ReplSession } from './shell-session'

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any) => {
  console.error(chalk.red('\n✗ Unhandled Promise Rejection:'))
  console.error(chalk.red(reason?.message || reason))
  if (reason?.stack) {
    console.error(chalk.gray(reason.stack))
  }
})

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error(chalk.red('\n✗ Uncaught Exception:'))
  console.error(chalk.red(error.message))
  if (error.stack) {
    console.error(chalk.gray(error.stack))
  }
})

// Configure password cache
const PASSWORD_CACHE_TTL = process.env.PASSWORD_CACHE_TTL ? parseInt(process.env.PASSWORD_CACHE_TTL) : 5 * 60 * 1000 // 5 minutes default

GlobalConfig.configure({
  passwordCache: {
    defaultTTL: PASSWORD_CACHE_TTL,
  },
  onPasswordRequired: async (vaultId: string, vaultName?: string) => {
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

// Initialize and start shell
async function main() {
  try {
    // Initialize SDK
    const sdk = new Vultisig()
    await sdk.initialize()

    // Start shell session
    const session = new ReplSession(sdk)
    await session.start()
  } catch (error: any) {
    console.error(chalk.red(`\n✗ Failed to start shell: ${error.message}`))
    process.exit(1)
  }
}

// Start the application
main().catch(error => {
  console.error(chalk.red('\n✗ Unhandled error in main:'), error)
  process.exit(1)
})
