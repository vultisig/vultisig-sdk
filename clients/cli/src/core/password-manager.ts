/**
 * Password Manager - Handles password resolution from various sources
 *
 * Priority order:
 * 1. In-memory cache (set by CLI --password flag or previous prompt)
 * 2. Stored credentials (OS keyring or encrypted file, set by `vsig auth setup`)
 * 3. VAULT_PASSWORDS env var (JSON object or whitespace-separated key:password entries)
 * 4. VAULT_PASSWORD env var (single fallback password; VULTISIG_PASSWORD is an alias)
 * 5. Interactive prompt (if no env password found and not in silent/JSON mode)
 */
import { isJsonOutput, isNonInteractive, isSilent, requireInteractive } from '../lib/output'
import { prompt } from '../lib/prompt'
import { getStoredServerPassword as getStoredPassword } from './credential-store'

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
 * Parse VAULT_PASSWORDS env var into a Map.
 *
 * Accepted formats:
 * - JSON object (recommended for vault names containing spaces)
 * - Legacy whitespace-separated key:password entries
 *
 * Legacy entries split on the last colon so keys may contain colons. Use the
 * JSON form whenever a key or password contains whitespace.
 */
export function parseVaultPasswords(): Map<string, string> {
  const passwordMap = new Map<string, string>()
  const passwordsEnv = process.env.VAULT_PASSWORDS?.trim()

  if (!passwordsEnv) return passwordMap

  if (passwordsEnv.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(passwordsEnv)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed)
        if (entries.every(([vaultKey, password]) => vaultKey.length > 0 && typeof password === 'string')) {
          return new Map(entries as Array<[string, string]>)
        }
      }
      throw new Error('expected an object with string values')
    } catch {
      process.stderr.write(
        'Warning: VAULT_PASSWORDS is not a valid JSON object with string values; falling back to legacy key:password parsing.\n'
      )
    }
  }

  for (const pair of passwordsEnv.split(/\s+/)) {
    const colonIndex = pair.lastIndexOf(':')
    if (colonIndex > 0) {
      const vaultKey = pair.substring(0, colonIndex)
      const password = pair.substring(colonIndex + 1)
      passwordMap.set(vaultKey, password)
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

  // Check single fallback password (VULTISIG_PASSWORD is the namespaced alias)
  if (process.env.VAULT_PASSWORD || process.env.VULTISIG_PASSWORD) {
    return (process.env.VAULT_PASSWORD || process.env.VULTISIG_PASSWORD)!
  }

  return null
}

/**
 * Prompt user for password interactively
 */
export async function promptForPassword(vaultName?: string, vaultId?: string): Promise<string> {
  requireInteractive(
    'Use --password, a vault password environment variable, or "vsig auth setup" to store credentials.'
  )
  const displayName = vaultName || vaultId || 'vault'
  const { password } = await prompt([
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
 * Resolve a password from the NON-INTERACTIVE chain only:
 * 1. In-memory cache (set by CLI --password flag or previous prompt)
 * 2. Stored credentials (OS keyring or encrypted file, set by `vsig auth setup`)
 * 3. Environment variables (`VAULT_PASSWORDS`, then the single-password fallback)
 *
 * Returns null when none of these is configured — it never prompts. Use this
 * when the caller has its own interactive prompt to fall back to (e.g. the
 * agent session's mode-specific UI callbacks), so the keyring/env chain is
 * consulted before a headless operator is forced onto argv `--password`.
 * Resolved passwords are cached for subsequent calls.
 */
export async function resolvePasswordNonInteractive(vaultId: string, vaultName?: string): Promise<string | null> {
  // 1. Check in-memory cache (includes explicit --password flag)
  const cachedPassword = getCachedPassword(vaultId, vaultName)
  if (cachedPassword) {
    return cachedPassword
  }

  // 2. Check stored credentials (OS keyring or encrypted file)
  try {
    const storedPassword = await getStoredPassword(vaultId)
    if (storedPassword) {
      cachePassword(vaultId, storedPassword)
      if (vaultName) cachePassword(vaultName, storedPassword)
      return storedPassword
    }
  } catch {
    // credential store not available or access failed — fall through
  }

  // 3. Try environment variables
  const envPassword = getPasswordFromEnv(vaultId, vaultName)
  if (envPassword) {
    // Cache env password for future calls
    cachePassword(vaultId, envPassword)
    if (vaultName) cachePassword(vaultName, envPassword)
    return envPassword
  }

  return null
}

/**
 * Get password using the standard resolution order:
 * 1. In-memory cache (set by CLI --password flag or previous prompt)
 * 2. Stored credentials (OS keyring or encrypted file, set by `vsig auth setup`)
 * 3. Environment variables (`VAULT_PASSWORDS`, then the single-password fallback)
 * 4. Interactive prompt (only if not in silent/JSON mode)
 *
 * Passwords are cached after resolution to avoid re-prompting in interactive mode.
 */
export async function getPassword(vaultId: string, vaultName?: string): Promise<string> {
  // 1–3. Cache → keyring → env (no prompting)
  const resolved = await resolvePasswordNonInteractive(vaultId, vaultName)
  if (resolved) {
    return resolved
  }

  // 4. In silent/JSON/non-interactive mode, we can't prompt - throw an error
  if (isSilent() || isJsonOutput() || isNonInteractive()) {
    throw new Error(
      'Password required but not provided. Set VAULT_PASSWORD or VAULT_PASSWORDS environment variable, or use --password flag.'
    )
  }

  // 5. Fall back to interactive prompt
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

  // Use provided password, or resolve from keyring/env/prompt
  const resolvedPassword = password || (await getPassword(vault.id, vault.name))
  await vault.unlock(resolvedPassword)
}
