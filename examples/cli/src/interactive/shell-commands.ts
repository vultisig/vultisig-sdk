/**
 * Shell-Only Commands - Commands that only exist in interactive mode
 *
 * - lock: Lock vault (clear cached password)
 * - unlock: Unlock vault (cache password)
 * - status: Show vault status
 */
import type { FiatCurrency } from '@vultisig/sdk/node'
import chalk from 'chalk'
import inquirer from 'inquirer'
import ora from 'ora'

import type { VaultStatus } from '../core/types'
import type { ShellContext } from './shell-context'

/**
 * Format time remaining in human-readable format
 */
export function formatTimeRemaining(ms: number | undefined): string {
  if (!ms || ms <= 0) return 'expired'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${remainingSeconds}s`
}

/**
 * Execute lock command - lock the active vault
 */
export async function executeLock(ctx: ShellContext): Promise<void> {
  const vault = ctx.getActiveVault()
  if (!vault) {
    console.log(chalk.red('No active vault.'))
    console.log(chalk.yellow('Use "vault <name>" to switch to a vault first.'))
    return
  }

  ctx.lockVault(vault.id)
  console.log(chalk.green('\n+ Vault locked'))
  console.log(chalk.gray('Password cache cleared. You will need to enter the password again.'))
}

/**
 * Execute unlock command - unlock the active vault
 */
export async function executeUnlock(ctx: ShellContext): Promise<void> {
  const vault = ctx.getActiveVault()
  if (!vault) {
    console.log(chalk.red('No active vault.'))
    console.log(chalk.yellow('Use "vault <name>" to switch to a vault first.'))
    return
  }

  if (ctx.isVaultUnlocked(vault.id)) {
    const timeRemaining = ctx.getUnlockTimeRemaining(vault.id)
    console.log(chalk.yellow('\nVault is already unlocked.'))
    console.log(chalk.gray(`Time remaining: ${formatTimeRemaining(timeRemaining)}`))
    return
  }

  const { password } = await inquirer.prompt([
    {
      type: 'password',
      name: 'password',
      message: 'Enter vault password:',
      mask: '*',
    },
  ])

  const spinner = ora('Unlocking vault...').start()

  try {
    await vault.unlock(password)
    ctx.cachePassword(vault.id, password)

    const timeRemaining = ctx.getUnlockTimeRemaining(vault.id)
    spinner.succeed('Vault unlocked')
    console.log(chalk.green(`\n+ Vault unlocked for ${formatTimeRemaining(timeRemaining)}`))
  } catch (err: any) {
    spinner.fail('Failed to unlock vault')
    console.error(chalk.red(`\nx ${err.message}`))
  }
}

/**
 * Execute status command - show vault status
 */
export async function executeStatus(ctx: ShellContext): Promise<void> {
  const vault = ctx.getActiveVault()
  if (!vault) {
    console.log(chalk.red('No active vault.'))
    console.log(chalk.yellow('Use "vault <name>" to switch to a vault first.'))
    return
  }

  const isUnlocked = ctx.isVaultUnlocked(vault.id)
  let timeRemaining: number | undefined
  let timeRemainingFormatted: string | undefined

  if (isUnlocked) {
    timeRemaining = ctx.getUnlockTimeRemaining(vault.id)
    timeRemainingFormatted = formatTimeRemaining(timeRemaining)
  }

  const status: VaultStatus = {
    name: vault.name,
    id: vault.id,
    type: vault.type,
    isUnlocked,
    timeRemaining,
    timeRemainingFormatted,
    createdAt: vault.createdAt,
    lastModified: vault.lastModified,
    threshold: vault.threshold,
    totalSigners: vault.totalSigners,
    libType: vault.libType,
    isEncrypted: vault.isEncrypted,
    isBackedUp: vault.isBackedUp,
    chains: vault.chains.length,
    currency: vault.currency as FiatCurrency,
    availableSigningModes: vault.availableSigningModes,
  }

  displayStatus(status)
}

/**
 * Display vault status
 */
function displayStatus(status: VaultStatus): void {
  console.log(chalk.cyan('\n+----------------------------------------+'))
  console.log(chalk.cyan('|            Vault Status                |'))
  console.log(chalk.cyan('+----------------------------------------+\n'))

  // Basic info
  console.log(chalk.bold('Vault:'))
  console.log(`  Name:     ${chalk.green(status.name)}`)
  console.log(`  ID:       ${status.id}`)
  console.log(`  Type:     ${chalk.yellow(status.type)}`)

  // Lock status
  console.log(chalk.bold('\nSecurity:'))
  if (status.isUnlocked) {
    console.log(`  Status:   ${chalk.green('Unlocked')} ${chalk.green('🔓')}`)
    console.log(`  Expires:  ${status.timeRemainingFormatted}`)
  } else {
    console.log(`  Status:   ${chalk.yellow('Locked')} ${chalk.yellow('🔒')}`)
  }
  console.log(`  Encrypted: ${status.isEncrypted ? chalk.green('Yes') : chalk.gray('No')}`)
  console.log(`  Backed Up: ${status.isBackedUp ? chalk.green('Yes') : chalk.yellow('No')}`)

  // MPC info
  console.log(chalk.bold('\nMPC Configuration:'))
  console.log(`  Library:   ${status.libType}`)
  console.log(`  Threshold: ${chalk.cyan(status.threshold)} of ${chalk.cyan(status.totalSigners)}`)

  // Signing modes
  console.log(chalk.bold('\nSigning Modes:'))
  status.availableSigningModes.forEach(mode => {
    console.log(`  - ${mode}`)
  })

  // Other info
  console.log(chalk.bold('\nDetails:'))
  console.log(`  Chains:   ${status.chains}`)
  console.log(`  Currency: ${status.currency.toUpperCase()}`)
  console.log(`  Created:  ${new Date(status.createdAt).toLocaleString()}`)
  console.log(`  Modified: ${new Date(status.lastModified).toLocaleString()}\n`)
}

/**
 * Show help for shell commands
 */
export function showHelp(): void {
  console.log(chalk.cyan('\n+================================================+'))
  console.log(chalk.cyan('|              Available Commands                |'))
  console.log(chalk.cyan('+================================================+'))

  console.log(chalk.cyan('|') + chalk.bold(' Vault Management:') + '                             ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  vaults              - List all vaults          ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  vault <name>        - Switch to vault          ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  import <file>       - Import vault from file   ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  create              - Create new vault         ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  info                - Show vault details       ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  export [path]       - Export vault to file     ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '                                                  ' + chalk.cyan('|'))

  console.log(chalk.cyan('|') + chalk.bold(' Wallet Operations:') + '                            ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  balance [chain]     - Show balances            ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  send <chain> <to> <amount> - Send transaction  ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  portfolio [-c usd]  - Show portfolio value     ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  addresses           - Show all addresses       ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  chains [--add/--remove] - Manage chains        ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  tokens <chain>      - Manage tokens            ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '                                                  ' + chalk.cyan('|'))

  console.log(chalk.cyan('|') + chalk.bold(' Swap Operations:') + '                              ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  swap-chains         - List swap-enabled chains ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  swap-quote <from> <to> <amount> - Get quote    ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  swap <from> <to> <amount> - Execute swap       ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '                                                  ' + chalk.cyan('|'))

  console.log(chalk.cyan('|') + chalk.bold(' Session Commands (shell only):') + '               ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  lock                - Lock vault               ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  unlock              - Unlock vault             ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  status              - Show vault status        ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '                                                  ' + chalk.cyan('|'))

  console.log(chalk.cyan('|') + chalk.bold(' Settings:') + '                                     ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  currency [code]     - View/set currency        ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  server              - Check server status      ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  address-book        - Manage saved addresses   ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '                                                  ' + chalk.cyan('|'))

  console.log(chalk.cyan('|') + chalk.bold(' Help & Navigation:') + '                            ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  help, ?             - Show this help           ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  .clear              - Clear screen             ' + chalk.cyan('|'))
  console.log(chalk.cyan('|') + '  .exit               - Exit shell               ' + chalk.cyan('|'))
  console.log(chalk.cyan('+================================================+\n'))
}
