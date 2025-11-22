import { ServerManager } from './ServerManager'

export type ServerEndpoints = {
  fastVault?: string
  messageRelay?: string
}

/**
 * Global ServerManager singleton.
 * Provides a single configured ServerManager instance for the entire application.
 *
 * @example
 * ```typescript
 * // Configure at app initialization
 * GlobalServerManager.configure({
 *   fastVault: 'https://api.vultisig.com/vault',
 *   messageRelay: 'https://api.vultisig.com/router'
 * })
 *
 * // Use anywhere
 * const serverManager = GlobalServerManager.getInstance()
 * ```
 */
export class GlobalServerManager {
  private static instance: ServerManager | undefined

  /**
   * Configure the global ServerManager instance.
   * Should be called once at application initialization.
   *
   * @param endpoints - Optional server endpoints (uses defaults if not provided)
   */
  static configure(endpoints?: ServerEndpoints): void {
    GlobalServerManager.instance = new ServerManager(endpoints)
  }

  /**
   * Get the configured ServerManager instance.
   * Falls back to default endpoints if not explicitly configured.
   *
   * @returns The global ServerManager instance
   */
  static getInstance(): ServerManager {
    if (!GlobalServerManager.instance) {
      // Lazy initialization with default endpoints
      GlobalServerManager.instance = new ServerManager()
    }
    return GlobalServerManager.instance
  }

  /**
   * Check if ServerManager has been explicitly configured.
   */
  static isConfigured(): boolean {
    return GlobalServerManager.instance !== undefined
  }

  /**
   * Reset the instance (useful for testing).
   * @internal
   */
  static reset(): void {
    GlobalServerManager.instance = undefined
  }
}
