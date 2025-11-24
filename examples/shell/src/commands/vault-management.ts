import { Vault } from '@vultisig/sdk'
import chalk from 'chalk'

/**
 * Display list of vaults
 */
export function displayVaultList(vaults: Vault[], activeVaultId?: string | number): void {
  if (vaults.length === 0) {
    console.log(chalk.yellow('\nNo vaults found'))
    console.log(chalk.gray('Use "import <file>" or "create <name> <email>" to add a vault'))
    return
  }

  console.log(chalk.cyan('\nAvailable Vaults:\n'))

  vaults.forEach((vault, index) => {
    const isActive = vault.id === activeVaultId
    const prefix = isActive ? chalk.green(`  ${index + 1}. [ACTIVE]`) : `  ${index + 1}.`
    const status = vault.isUnlocked() ? chalk.green('🔓') : chalk.yellow('🔒')

    console.log(`${prefix} ${vault.name} ${status}`)
    console.log(chalk.gray(`     Type: Fast Vault`))

    const chains = vault.getChains()
    if (chains.length > 0) {
      console.log(chalk.gray(`     Chains: ${chains.join(', ')} (${chains.length})`))
    } else {
      console.log(chalk.gray(`     Chains: None`))
    }

    console.log('')
  })
}

/**
 * Display vault imported confirmation
 */
export function displayVaultImported(vault: Vault): void {
  console.log(chalk.green('\n✓ Vault imported successfully!'))
  console.log(chalk.blue(`Vault: ${vault.name}`))
  console.log(chalk.blue('Run "npm run wallet balance" to view balances'))
}

/**
 * Display vault created confirmation
 */
export function displayVaultCreated(_vaultName: string): void {
  console.log(chalk.green('\n✓ Vault created!'))
  console.log(chalk.blue('\nYour vault is ready. Run the following commands:'))
  console.log(chalk.cyan('  npm run wallet balance     ') + '- View balances')
  console.log(chalk.cyan('  npm run wallet addresses   ') + '- View addresses')
  console.log(chalk.cyan('  npm run wallet portfolio   ') + '- View portfolio value')
}
