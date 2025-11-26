import type { Storage } from "./types";

/**
 * Global storage singleton.
 *
 * Provides a single configured storage instance for the entire application.
 * Classes can access storage without constructor parameter drilling.
 *
 * Platform-specific bundles automatically configure storage.
 *
 * Usage:
 * ```typescript
 * // In platform entry (automatic):
 * GlobalStorage.configure(new NodeStorage())
 *
 * // In any class:
 * const storage = GlobalStorage.getInstance()
 * const value = await storage.get('key')
 * ```
 */
export class GlobalStorage {
  private static instance: Storage | undefined;

  /**
   * Configure global storage instance.
   * Should be called once at application initialization.
   *
   * @param storage - Storage instance to use
   *
   * @example
   * ```typescript
   * // Use Node.js file storage
   * GlobalStorage.configure(new NodeStorage({ basePath: '/custom/path' }))
   *
   * // Use browser storage
   * GlobalStorage.configure(new BrowserStorage())
   * GlobalStorage.configure({ type: 'browser' })
   *
   * // Use custom storage
   * GlobalStorage.configure(myStorage)
   * ```
   */
  static configure(storage: Storage): void {
    GlobalStorage.instance = storage;
  }

  /**
   * Get the configured storage instance.
   * Platform-specific bundles automatically configure storage.
   *
   * @returns Storage instance
   * @throws Error if storage has not been configured
   */
  static getInstance(): Storage {
    if (!GlobalStorage.instance) {
      throw new Error(
        "GlobalStorage not configured. " +
          "This should be automatic when using platform-specific bundles. " +
          "If using legacy builds, call GlobalStorage.configure(storage) manually.",
      );
    }
    return GlobalStorage.instance;
  }

  /**
   * Check if storage has been explicitly configured.
   *
   * @returns true if configure() was called
   */
  static isConfigured(): boolean {
    return GlobalStorage.instance !== undefined;
  }

  /**
   * Reset storage instance (useful for testing).
   *
   * @internal
   */
  static reset(): void {
    GlobalStorage.instance = undefined;
  }
}
