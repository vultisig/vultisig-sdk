#!/usr/bin/env node
import 'dotenv/config'

import { GlobalConfig } from '@vultisig/sdk'
import chalk from 'chalk'
import inquirer from 'inquirer'

import { ReplSession } from './shell-session'
import { VaultManager } from './utils/wallet'

// Configure password cache
const PASSWORD_CACHE_TTL = process.env.PASSWORD_CACHE_TTL
  ? parseInt(process.env.PASSWORD_CACHE_TTL)
  : 5 * 60 * 1000 // 5 minutes default

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
    // Initialize vault manager
    const vaultManager = new VaultManager()
    await vaultManager.initialize()

    // Start shell session
    const session = new ReplSession(vaultManager)
    await session.start()
  } catch (error: any) {
    console.error(chalk.red(`\n✗ Failed to start shell: ${error.message}`))
    process.exit(1)
  }
}

// Start the application
main()
