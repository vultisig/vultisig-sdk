/**
 * Storage version for migration support
 */
export const STORAGE_VERSION = 1

/**
 * Storage metadata for versioning and migration
 */
export type StorageMetadata = {
  version: number
  createdAt: number
  lastModified: number
}

/**
 * Stored value with metadata
 */
export type StoredValue<T = unknown> = {
  value: T
  metadata: StorageMetadata
}

/**
 * Universal storage interface for vault persistence.
 * All implementations must support async operations and provide atomic writes.
 * Custom adapters may share their backing store with host application data.
 * The SDK reserves `vault:*`, `pending:*`, `cache:*`, `addressBook:*`,
 * `activeVaultId`, `pushNotificationRegistrations`, `config:defaultCurrency`,
 * and `config:defaultChains`. `clearVaults()` removes the vault-scoped keys and
 * notification registrations but intentionally retains the two SDK preference
 * keys. `clear()` remains an explicit adapter-wide operation.
 */
export type Storage = {
  /**
   * Retrieve a value by key.
   * @returns The value if found, null otherwise
   */
  get<T>(key: string): Promise<T | null>

  /**
   * Store a value with a key.
   * @throws StorageError if quota exceeded or storage unavailable
   */
  set<T>(key: string, value: T): Promise<void>

  /**
   * Remove a value by key.
   */
  remove(key: string): Promise<void>

  /**
   * List all stored keys (excluding metadata keys).
   */
  list(): Promise<string[]>

  /**
   * Clear all data in the adapter, including non-SDK host keys.
   * SDK vault APIs do not call this adapter-wide operation.
   * @throws StorageError if operation not permitted
   */
  clear(): Promise<void>

  /**
   * Get storage usage information.
   * @returns Estimated size in bytes
   */
  getUsage?(): Promise<number>

  /**
   * Get storage quota information.
   * @returns Available quota in bytes, or undefined if unlimited
   */
  getQuota?(): Promise<number | undefined>
}

/**
 * Storage error codes
 */
export enum StorageErrorCode {
  QuotaExceeded = 'QUOTA_EXCEEDED',
  StorageUnavailable = 'STORAGE_UNAVAILABLE',
  PermissionDenied = 'PERMISSION_DENIED',
  InvalidKey = 'INVALID_KEY',
  SerializationFailed = 'SERIALIZATION_FAILED',
  EncryptionFailed = 'ENCRYPTION_FAILED',
  DecryptionFailed = 'DECRYPTION_FAILED',
  Unknown = 'UNKNOWN',
}

/**
 * Storage-specific errors
 */
export class StorageError extends Error {
  constructor(
    public code: StorageErrorCode,
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'StorageError'
  }
}
