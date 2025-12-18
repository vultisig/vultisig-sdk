/**
 * Password Manager - Handles password resolution from various sources
 *
 * Priority order:
 * 1. VAULT_PASSWORDS env var (format: "VaultName:password VaultId:password")
 * 2. VAULT_PASSWORD env var (single fallback password)
 * 3. Interactive prompt (if no env password found and not in silent/JSON mode)
 */
import inquirer from 'inquirer'

import { isJsonOutput, isSilent } from '../lib/output'

/**
 * Parse VAULT_PASSWORDS env var into a Map
 * Format: "VaultName:password VaultId:password"
 */
export function parseVaultPasswords(): Map<string, string> {
  const passwordMap = new Map<string, string>()
  const passwordsEnv = process.env.VAULT_PASSWORDS

  if (passwordsEnv) {
    const pairs = passwordsEnv.trim().split(/\s+/)
    for (const pair of pairs) {
      const colonIndex = pair.indexOf(':')
      if (colonIndex > 0) {
        const vaultKey = pair.substring(0, colonIndex)
        const password = pair.substring(colonIndex + 1)
        passwordMap.set(vaultKey, password)
      }
    }
  }

  return passwordMap
}

/**
 * Get password from environment variables
 * Returns null if not found in env
 */
export function getPasswordFromEnv(vaultId: string, vaultName?: string): string | null {
  const vaultPasswords = parseVaultPasswords()

  // Check by vault name first
  if (vaultName && vaultPasswords.has(vaultName)) {
    return vaultPasswords.get(vaultName)!
  }

  // Check by vault ID
  if (vaultPasswords.has(vaultId)) {
    return vaultPasswords.get(vaultId)!
  }

  // Check single fallback password
  if (process.env.VAULT_PASSWORD) {
    return process.env.VAULT_PASSWORD
  }

  return null
}

/**
 * Prompt user for password interactively
 */
export async function promptForPassword(vaultName?: string, vaultId?: string): Promise<string> {
  const displayName = vaultName || vaultId || 'vault'
  const { password } = await inquirer.prompt([
    {
      type: 'password',
      name: 'password',
      message: `Enter password for vault "${displayName}":`,
      mask: '*',
    },
  ])
  return password
}

/**
 * Get password using the standard resolution order:
 * 1. Environment variables
 * 2. Interactive prompt (only if not in silent/JSON mode)
 */
export async function getPassword(vaultId: string, vaultName?: string): Promise<string> {
  // Try environment first
  const envPassword = getPasswordFromEnv(vaultId, vaultName)
  if (envPassword) {
    return envPassword
  }

  // In silent/JSON mode, we can't prompt - throw an error
  if (isSilent() || isJsonOutput()) {
    throw new Error('Password required but not provided. Set VAULT_PASSWORD or VAULT_PASSWORDS environment variable.')
  }

  // Fall back to interactive prompt
  return promptForPassword(vaultName, vaultId)
}

/**
 * Create an onPasswordRequired callback for SDK initialization
 */
export function createPasswordCallback(): (vaultId: string, vaultName?: string) => Promise<string> {
  return async (vaultId: string, vaultName?: string): Promise<string> => {
    return getPassword(vaultId, vaultName)
  }
}

/**
 * Ensure a vault is unlocked before signing operations.
 * This should be called BEFORE starting any spinner to avoid prompt interference.
 *
 * @param vault - The vault to unlock
 * @param password - Optional password provided via CLI flag
 */
export async function ensureVaultUnlocked(
  vault: {
    isEncrypted: boolean
    isUnlocked: () => boolean
    unlock: (password: string) => Promise<void>
    id: string
    name: string
  },
  password?: string
): Promise<void> {
  // Skip if vault doesn't need unlocking
  if (!vault.isEncrypted || vault.isUnlocked()) {
    return
  }

  if (password) {
    // Use CLI-provided password
    await vault.unlock(password)
    return
  }

  // Prompt for password before spinner starts
  const inputPassword = await promptForPassword(vault.name, vault.id)
  await vault.unlock(inputPassword)
}
