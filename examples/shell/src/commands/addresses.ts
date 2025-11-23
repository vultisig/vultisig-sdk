import { Vault } from '@vultisig/sdk'
import chalk from 'chalk'

/**
 * Get all addresses for the vault
 */
export async function handleAddresses(
  vault: Vault
): Promise<Record<string, string>> {
  return await vault.addresses()
}

/**
 * Display addresses in a formatted table
 */
export function displayAddresses(addresses: Record<string, string>): void {
  console.log(chalk.cyan('\nVault Addresses:\n'))

  const table = Object.entries(addresses).map(([chain, address]) => ({
    Chain: chain,
    Address: address,
  }))

  console.table(table)
}
