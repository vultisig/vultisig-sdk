import { FastVault, Vault, Vultisig } from '@vultisig/sdk'
import chalk from 'chalk'
import { promises as fs } from 'fs'

export type VaultListItem = {
  vault: Vault
  isActive: boolean
  isUnlocked: boolean
  chains: string[]
}

/**
 * Get all vaults from storage
 */
export async function handleListVaults(sdk: Vultisig): Promise<Vault[]> {
  return await sdk.listVaults()
}

/**
 * Import vault from file
 */
export async function handleImportVault(
  sdk: Vultisig,
  filePath: string,
  password?: string
): Promise<Vault> {
  // Check if file exists
  await fs.access(filePath)

  // Read vault file
  const vultContent = await fs.readFile(filePath, 'utf-8')

  // Import vault
  const vault = await sdk.importVault(vultContent, password)
  return vault
}

/**
 * Create a new vault
 */
export async function handleCreateVault(
  sdk: Vultisig,
  name: string,
  password: string,
  email: string
): Promise<{ vault: Vault; vaultId: string; verificationRequired: boolean }> {
  const result = await FastVault.create({
    name,
    password,
    email,
  })

  return {
    vault: result.vault,
    vaultId: result.vaultId,
    verificationRequired: result.verificationRequired,
  }
}

/**
 * Verify vault with email code
 */
export async function handleVerifyVault(
  sdk: Vultisig,
  vaultId: string,
  code: string
): Promise<boolean> {
  return await sdk.verifyVault(vaultId, code)
}

/**
 * Resend verification email
 */
export async function handleResendVerification(
  sdk: Vultisig,
  vaultId: string
): Promise<void> {
  await sdk.resendVerification(vaultId)
}

/**
 * Display list of vaults
 */
export function displayVaultList(
  vaults: Vault[],
  activeVaultId?: string | number
): void {
  if (vaults.length === 0) {
    console.log(chalk.yellow('\nNo vaults found'))
    console.log(
      chalk.gray(
        'Use "import <file>" or "create <name> <email>" to add a vault'
      )
    )
    return
  }

  console.log(chalk.cyan('\nAvailable Vaults:\n'))

  vaults.forEach((vault, index) => {
    const isActive = vault.id === activeVaultId
    const prefix = isActive
      ? chalk.green(`  ${index + 1}. [ACTIVE]`)
      : `  ${index + 1}.`
    const status = vault.isUnlocked() ? chalk.green('🔓') : chalk.yellow('🔒')

    console.log(`${prefix} ${vault.name} ${status}`)
    console.log(chalk.gray(`     Type: Fast Vault`))

    const chains = vault.getChains()
    if (chains.length > 0) {
      console.log(
        chalk.gray(`     Chains: ${chains.join(', ')} (${chains.length})`)
      )
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
  console.log(
    chalk.cyan('  npm run wallet portfolio   ') + '- View portfolio value'
  )
}
