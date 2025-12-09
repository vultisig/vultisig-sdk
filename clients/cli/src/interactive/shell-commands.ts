/**
 * Shell-Only Commands - Commands that only exist in interactive mode
 *
 * - lock: Lock vault (clear cached password)
 * - unlock: Unlock vault (cache password)
 * - status: Show vault status
 */
import type { FiatCurrency } from '@vultisig/sdk'
import chalk from 'chalk'
import Table from 'cli-table3'
import ora from 'ora'

import type { VaultStatus } from '../core/types'
import { replPrompt } from './repl-prompt'
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

  const { password } = await replPrompt([
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
  const table = new Table({
    head: [chalk.bold('Available Commands')],
    colWidths: [50],
    chars: {
      mid: '',
      'left-mid': '',
      'mid-mid': '',
      'right-mid': '',
    },
    style: {
      head: ['cyan'],
      border: ['cyan'],
    },
  })

  table.push(
    [chalk.bold('Vault Management:')],
    ['  vaults              - List all vaults'],
    ['  vault <name>        - Switch to vault'],
    ['  import <file>       - Import vault from file'],
    ['  create              - Create new vault'],
    ['  info                - Show vault details'],
    ['  export [path]       - Export vault to file'],
    [''],
    [chalk.bold('Wallet Operations:')],
    ['  balance [chain]     - Show balances'],
    ['  send <chain> <to> <amount> - Send transaction'],
    ['  portfolio [-c usd]  - Show portfolio value'],
    ['  addresses           - Show all addresses'],
    ['  chains [--add/--remove] - Manage chains'],
    ['  tokens <chain>      - Manage tokens'],
    [''],
    [chalk.bold('Swap Operations:')],
    ['  swap-chains         - List swap-enabled chains'],
    ['  swap-quote <from> <to> <amount> - Get quote'],
    ['  swap <from> <to> <amount> - Execute swap'],
    [''],
    [chalk.bold('Session Commands (shell only):')],
    ['  lock                - Lock vault'],
    ['  unlock              - Unlock vault'],
    ['  status              - Show vault status'],
    [''],
    [chalk.bold('Settings:')],
    ['  currency [code]     - View/set currency'],
    ['  server              - Check server status'],
    ['  address-book        - Manage saved addresses'],
    [''],
    [chalk.bold('Help & Navigation:')],
    ['  help, ?             - Show this help'],
    ['  .clear              - Clear screen'],
    ['  .exit               - Exit shell']
  )

  console.log('\n' + table.toString() + '\n')
}
