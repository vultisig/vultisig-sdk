/**
 * Node.js-specific utility functions.
 *
 * These helpers simplify Node.js integration by providing:
 * - File-based vault import/export
 * - Storage path access
 * - Storage usage information
 *
 * Usage:
 * ```typescript
 * import { Vultisig } from '@vultisig/sdk'
 * import { exportVaultToFile, importVaultFromFile } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig()
 * const vault = sdk.getActiveVault()
 *
 * // Export vault
 * await exportVaultToFile(vault, '/path/to/backup.vult')
 *
 * // Import vault
 * const file = await importVaultFromFile('/path/to/vault.vult', 'password')
 * await sdk.addVault(file, 'password')
 * ```
 */

import type { Vault as VaultClass } from '../../vault/Vault'
import { isNode } from '../environment'
import type { NodeStorage } from '../storage/NodeStorage'

/**
 * Export vault to file (Node.js only).
 * This uses Node.js file system APIs to write the vault to disk.
 *
 * @param vault - Vault instance to export
 * @param filePath - Absolute path where vault should be saved
 * @throws Error if not running in Node.js environment
 *
 * @example
 * ```typescript
 * const vault = sdk.getActiveVault()
 * await exportVaultToFile(vault, '/home/user/backups/my-vault.vult')
 * ```
 */
export async function exportVaultToFile(
  vault: VaultClass,
  filePath: string
): Promise<void> {
  if (!isNode()) {
    throw new Error(
      'exportVaultToFile can only be called in Node.js environment'
    )
  }

  const fs = await import('fs/promises')

  // Export vault as blob
  const blob = await vault.export()

  // Convert blob to buffer
  const arrayBuffer = await blob.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Write to file with secure permissions (owner read/write only)
  await fs.writeFile(filePath, buffer, { mode: 0o600 })
}

/**
 * Import vault from file (Node.js only).
 * Reads a vault file and returns a File object that can be passed to sdk.addVault().
 *
 * @param filePath - Absolute path to vault file
 * @param password - Optional password for encrypted vaults
 * @returns File object ready for import
 * @throws Error if not running in Node.js environment
 *
 * @example
 * ```typescript
 * const file = await importVaultFromFile('/path/to/vault.vult', 'password')
 * const vault = await sdk.addVault(file, 'password')
 * ```
 */
export async function importVaultFromFile(
  filePath: string,
  _password?: string
): Promise<File> {
  if (!isNode()) {
    throw new Error(
      'importVaultFromFile can only be called in Node.js environment'
    )
  }

  const fs = await import('fs/promises')
  const path = await import('path')

  // Read file
  const buffer = await fs.readFile(filePath)

  // Create File object
  const filename = path.basename(filePath)
  const blob = new Blob([buffer as BlobPart], { type: 'application/json' })
  const file = new File([blob], filename)

  return file
}

/**
 * Get storage directory path (Node.js only).
 * Returns the absolute path where vaults are stored.
 *
 * @param storage - NodeStorage instance (from sdk.storage if it's NodeStorage)
 * @returns Absolute path to storage directory
 * @throws Error if not running in Node.js environment
 *
 * @example
 * ```typescript
 * import { Vultisig, NodeStorage } from '@vultisig/sdk'
 * import { getStoragePath } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig()
 * const storage = (sdk as any).storage as NodeStorage
 * const path = getStoragePath(storage)
 * console.log('Vaults stored at:', path)
 * ```
 */
export function getStoragePath(storage: NodeStorage): string {
  if (!isNode()) {
    throw new Error('getStoragePath can only be called in Node.js environment')
  }

  return storage.basePath
}

/**
 * Get storage usage information (Node.js only).
 * Returns the total size of all stored vaults.
 *
 * @param storage - NodeStorage instance
 * @returns Storage usage information
 * @throws Error if not running in Node.js environment
 *
 * @example
 * ```typescript
 * import { getNodeStorageInfo } from '@vultisig/sdk'
 *
 * const storage = (sdk as any).storage as NodeStorage
 * const info = await getNodeStorageInfo(storage)
 * console.log(`Using ${info.usage} bytes at ${info.path}`)
 * ```
 */
export async function getNodeStorageInfo(storage: NodeStorage): Promise<{
  usage: number
  path: string
}> {
  if (!isNode()) {
    throw new Error(
      'getNodeStorageInfo can only be called in Node.js environment'
    )
  }

  const usage = (await storage.getUsage?.()) ?? 0

  return {
    usage,
    path: getStoragePath(storage),
  }
}

/**
 * Ensure a directory exists, creating it if necessary (Node.js only).
 * Useful for ensuring backup directories exist before exporting vaults.
 *
 * @param dirPath - Directory path to ensure exists
 * @throws Error if not running in Node.js environment
 *
 * @example
 * ```typescript
 * import { ensureDirectory, exportVaultToFile } from '@vultisig/sdk'
 *
 * await ensureDirectory('/home/user/vault-backups')
 * await exportVaultToFile(vault, '/home/user/vault-backups/backup.vult')
 * ```
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  if (!isNode()) {
    throw new Error('ensureDirectory can only be called in Node.js environment')
  }

  const fs = await import('fs/promises')
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 })
}
