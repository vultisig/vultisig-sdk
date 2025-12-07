/**
 * CommandContext - Shared context interface for CLI and Interactive Shell
 *
 * This interface provides a unified way for commands to access:
 * - SDK instance
 * - Active vault state
 * - Password management
 * - Mode information (CLI vs interactive)
 */
import type { VaultBase, Vultisig } from '@vultisig/sdk'

/**
 * Password cache entry with expiration
 */
export type PasswordCacheEntry = {
  password: string
  expiresAt: number
}

/**
 * CommandContext provides everything a command needs to execute
 */
export type CommandContext = {
  // SDK access
  readonly sdk: Vultisig

  // Vault state
  getActiveVault(): VaultBase | null
  setActiveVault(vault: VaultBase): Promise<void>
  ensureActiveVault(): Promise<VaultBase>

  // Password management
  getPassword(vaultId: string, vaultName?: string): Promise<string>
  cachePassword(vaultId: string, password: string, ttlMs?: number): void
  clearPasswordCache(vaultId?: string): void
  isPasswordCached(vaultId: string): boolean

  // Mode information
  readonly isInteractive: boolean

  // Cleanup
  dispose(): void
}

/**
 * Default password cache TTL (5 minutes)
 */
export const DEFAULT_PASSWORD_CACHE_TTL = 5 * 60 * 1000

/**
 * Base implementation of CommandContext that can be extended
 * by CLI and Shell-specific implementations
 */
export abstract class BaseCommandContext implements CommandContext {
  protected _sdk: Vultisig
  protected _activeVault: VaultBase | null = null
  protected passwordCache: Map<string, PasswordCacheEntry> = new Map()
  protected defaultPasswordTtl: number

  constructor(sdk: Vultisig, options?: { passwordTtlMs?: number }) {
    this._sdk = sdk
    this.defaultPasswordTtl = options?.passwordTtlMs ?? DEFAULT_PASSWORD_CACHE_TTL
  }

  get sdk(): Vultisig {
    return this._sdk
  }

  abstract get isInteractive(): boolean

  getActiveVault(): VaultBase | null {
    return this._activeVault
  }

  async setActiveVault(vault: VaultBase): Promise<void> {
    this._activeVault = vault
    await this._sdk.setActiveVault(vault)
  }

  async ensureActiveVault(): Promise<VaultBase> {
    if (!this._activeVault) {
      // Try to load from SDK
      const vault = await this._sdk.getActiveVault()
      if (vault) {
        this._activeVault = vault
      }
    }

    if (!this._activeVault) {
      throw new Error('No active vault. Create or import a vault first.')
    }

    return this._activeVault
  }

  /**
   * Get password for a vault - must be implemented by subclasses
   * CLI will prompt or use env vars
   * Shell will use cache or prompt
   */
  abstract getPassword(vaultId: string, vaultName?: string): Promise<string>

  cachePassword(vaultId: string, password: string, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultPasswordTtl
    this.passwordCache.set(vaultId, {
      password,
      expiresAt: Date.now() + ttl,
    })
  }

  clearPasswordCache(vaultId?: string): void {
    if (vaultId) {
      this.passwordCache.delete(vaultId)
    } else {
      this.passwordCache.clear()
    }
  }

  isPasswordCached(vaultId: string): boolean {
    const entry = this.passwordCache.get(vaultId)
    if (!entry) return false
    if (Date.now() > entry.expiresAt) {
      this.passwordCache.delete(vaultId)
      return false
    }
    return true
  }

  protected getCachedPassword(vaultId: string): string | null {
    const entry = this.passwordCache.get(vaultId)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.passwordCache.delete(vaultId)
      return null
    }
    return entry.password
  }

  dispose(): void {
    this.passwordCache.clear()
    this._sdk.dispose()
  }
}
