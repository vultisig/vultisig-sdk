/**
 * Vultisig Provider - Unified vault provider for browser, Node.js, and Electron
 *
 * @packageDocumentation
 */

// ============================================
// Types & Interfaces
// ============================================
export * from './types'
export * from './events/types'

// ============================================
// Provider Implementations
// ============================================
export { BaseProvider } from './BaseProvider'
export { BrowserProvider } from './BrowserProvider'
export { NodeProvider } from './NodeProvider'
export { ElectronProvider } from './ElectronProvider'

// ============================================
// Factory Functions (Recommended Entry Point)
// ============================================
export {
  createProvider,
  createBrowserProvider,
  createNodeProvider,
  createElectronProvider,
} from './factory'

// ============================================
// Storage Abstraction
// ============================================
export type { VaultStorage, StorageMetadata, StoredValue } from './storage/types'
export { StorageError, StorageErrorCode } from './storage/types'
export { BrowserStorage } from './storage/BrowserStorage'
export { NodeStorage } from './storage/NodeStorage'
export { MemoryStorage } from './storage/MemoryStorage'

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
  isWorker,
  getEnvironmentInfo,
} from './environment'
export type { Environment } from './environment'

// ============================================
// Event System
// ============================================
export { UniversalEventEmitter } from './events/EventEmitter'
