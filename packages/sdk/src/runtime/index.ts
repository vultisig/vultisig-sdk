/**
 * Vultisig Runtime Infrastructure
 *
 * This module contains the runtime infrastructure components used by the Vultisig SDK:
 * - Storage abstractions (Browser, Node, Memory, Chrome Extension)
 * - Environment detection utilities
 * - Environment-specific utilities (Browser, Node, Electron, Chrome)
 *
 * @packageDocumentation
 */

// ============================================
// Storage Abstraction
// ============================================
export type { VaultStorage, StorageMetadata, StoredValue } from './storage/types'
export { StorageError, StorageErrorCode } from './storage/types'
export { StorageManager } from './storage/StorageManager'
export type { StorageOptions } from './storage/StorageManager'
export { BrowserStorage } from './storage/BrowserStorage'
export { NodeStorage } from './storage/NodeStorage'
export { MemoryStorage } from './storage/MemoryStorage'
export { ChromeStorage } from './storage/ChromeStorage'

// ============================================
// Environment Detection
// ============================================
export {
  detectEnvironment,
  isBrowser,
  isNode,
  isElectron,
  isElectronMain,
  isElectronRenderer,
  isChromeExtension,
  isChromeExtensionServiceWorker,
  isChromeExtensionPage,
  isWorker,
  getEnvironmentInfo,
} from './environment'
export type { Environment } from './environment'

// ============================================
// Environment-Specific Utilities
// ============================================
export * from './utils'
