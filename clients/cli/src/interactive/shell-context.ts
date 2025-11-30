/**
 * Shell Context - CommandContext implementation for Interactive Shell mode
 *
 * In Shell mode:
 * - Persistent session with multiple commands
 * - Password caching with TTL
 * - Lock/unlock support
 */
import type { VaultBase, Vultisig } from '@vultisig/sdk/node'
import inquirer from 'inquirer'

import { BaseCommandContext, DEFAULT_PASSWORD_CACHE_TTL } from '../core/command-context'
import { getPasswordFromEnv } from '../core/password-manager'

/**
 * Shell-specific implementation of CommandContext
 */
export class ShellContext extends BaseCommandContext {
  private vaults: Map<string, VaultBase> = new Map()

  constructor(sdk: Vultisig, options?: { passwordTtlMs?: number }) {
    super(sdk, options)
  }

  get isInteractive(): boolean {
    return true
  }

  /**
   * Get all loaded vaults
   */
  getVaults(): Map<string, VaultBase> {
    return this.vaults
  }

  /**
   * Add a vault to the context
   */
  addVault(vault: VaultBase): void {
    this.vaults.set(vault.id, vault)
  }

  /**
   * Get vault by ID
   */
  getVaultById(id: string): VaultBase | undefined {
    return this.vaults.get(id)
  }

  /**
   * Find vault by name (case-insensitive)
   */
  findVaultByName(name: string): VaultBase | null {
    const nameLower = name.toLowerCase()
    for (const vault of this.vaults.values()) {
      if (vault.name.toLowerCase() === nameLower) {
        return vault
      }
    }
    return null
  }

  /**
   * Get password for a vault
   * In Shell mode, we check cache first, then env, then prompt
   * Passwords are cached for the session
   */
  async getPassword(vaultId: string, vaultName?: string): Promise<string> {
    // Check cache first
    const cached = this.getCachedPassword(vaultId)
    if (cached) {
      return cached
    }

    // Check env vars
    const envPassword = getPasswordFromEnv(vaultId, vaultName)
    if (envPassword) {
      // Cache the env password too
      this.cachePassword(vaultId, envPassword)
      return envPassword
    }

    // Prompt for password
    const displayName = vaultName || vaultId
    const { password } = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: `Enter password for vault "${displayName}":`,
        mask: '*',
      },
    ])

    // Cache for the session
    this.cachePassword(vaultId, password)

    return password
  }

  /**
   * Lock a vault (clear its cached password)
   */
  lockVault(vaultId: string): void {
    this.clearPasswordCache(vaultId)
    const vault = this.vaults.get(vaultId)
    if (vault) {
      vault.lock()
    }
  }

  /**
   * Get unlock time remaining for a vault
   */
  getUnlockTimeRemaining(vaultId: string): number | undefined {
    const entry = this.passwordCache.get(vaultId)
    if (!entry) return undefined
    const remaining = entry.expiresAt - Date.now()
    return remaining > 0 ? remaining : undefined
  }

  /**
   * Check if a vault is unlocked (has cached password)
   */
  isVaultUnlocked(vaultId: string): boolean {
    return this.isPasswordCached(vaultId)
  }
}

/**
 * Create a Shell context from an initialized SDK
 */
export function createShellContext(sdk: Vultisig, options?: { passwordTtlMs?: number }): ShellContext {
  return new ShellContext(sdk, {
    passwordTtlMs: options?.passwordTtlMs ?? DEFAULT_PASSWORD_CACHE_TTL,
  })
}
