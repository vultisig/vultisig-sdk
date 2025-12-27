/**
 * Password Manager - Handles password resolution from various sources
 *
 * Priority order:
 * 1. In-memory cache (set by CLI --password flag or previous prompt)
 * 2. VAULT_PASSWORDS env var (format: "VaultName:password VaultId:password")
 * 3. VAULT_PASSWORD env var (single fallback password)
 * 4. Interactive prompt (if no env password found and not in silent/JSON mode)
 */
import inquirer from 'inquirer'

import { isJsonOutput, isSilent } from '../lib/output'

/**
 * In-memory password cache
 * Checked before env vars and prompts. Used by:
 * - CLI --password flag (cached before SDK init)
 * - Previous prompts (cached after user enters password)
 */
const passwordCache = new Map<string, string>()

/**
 * Cache a password for a vault (by ID or name)
 */
export function cachePassword(vaultIdOrName: string, password: string): void {
  passwordCache.set(vaultIdOrName, password)
}

/**
 * Get a cached password by vault ID or name
 */
export function getCachedPassword(vaultId: string, vaultName?: string): string | null {
  if (vaultName && passwordCache.has(vaultName)) return passwordCache.get(vaultName)!
  if (passwordCache.has(vaultId)) return passwordCache.get(vaultId)!
  return null
}

/**
 * Clear cached password(s)
 */
export function clearCachedPassword(vaultIdOrName?: string): void {
  if (vaultIdOrName) {
    passwordCache.delete(vaultIdOrName)
  } else {
    passwordCache.clear()
  }
}

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
 * 1. In-memory cache (set by CLI --password flag or previous prompt)
 * 2. Environment variables
 * 3. Interactive prompt (only if not in silent/JSON mode)
 *
 * Passwords are cached after resolution to avoid re-prompting in interactive mode.
 */
export async function getPassword(vaultId: string, vaultName?: string): Promise<string> {
  // 1. Check in-memory cache first
  const cachedPassword = getCachedPassword(vaultId, vaultName)
  if (cachedPassword) {
    return cachedPassword
  }

  // 2. Try environment variables
  const envPassword = getPasswordFromEnv(vaultId, vaultName)
  if (envPassword) {
    // Cache env password for future calls
    cachePassword(vaultId, envPassword)
    if (vaultName) cachePassword(vaultName, envPassword)
    return envPassword
  }

  // 3. In silent/JSON mode, we can't prompt - throw an error
  if (isSilent() || isJsonOutput()) {
    throw new Error('Password required but not provided. Set VAULT_PASSWORD or VAULT_PASSWORDS environment variable.')
  }

  // 4. Fall back to interactive prompt
  const password = await promptForPassword(vaultName, vaultId)

  // Cache the prompted password for future calls (critical for interactive mode)
  cachePassword(vaultId, password)
  if (vaultName) cachePassword(vaultName, password)

  return password
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
