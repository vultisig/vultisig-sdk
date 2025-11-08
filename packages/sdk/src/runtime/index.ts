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
export { BrowserStorage } from './storage/BrowserStorage'
export { ChromeStorage } from './storage/ChromeStorage'
export { MemoryStorage } from './storage/MemoryStorage'
export { NodeStorage } from './storage/NodeStorage'
export type { StorageOptions } from './storage/StorageManager'
export { StorageManager } from './storage/StorageManager'
export type {
  StorageMetadata,
  StoredValue,
  VaultStorage,
} from './storage/types'
export { StorageError, StorageErrorCode } from './storage/types'

// ============================================
// Environment Detection
// ============================================
export type { Environment } from './environment'
export {
  detectEnvironment,
  getEnvironmentInfo,
  isBrowser,
  isChromeExtension,
  isChromeExtensionPage,
  isChromeExtensionServiceWorker,
  isElectron,
  isElectronMain,
  isElectronRenderer,
  isNode,
  isWorker,
} from './environment'

// ============================================
// Environment-Specific Utilities
// ============================================
export * from './utils'
