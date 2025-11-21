// Crypto utilities (cross-platform)
export { getCrypto, randomUUID } from '../crypto'

// Browser utilities
export {
  downloadVault,
  getBrowserStorageInfo,
  isBrowserStorageLow,
  isPersistentStorage,
  requestPersistentStorage,
} from './browser'

// Node.js utilities
export {
  ensureDirectory,
  exportVaultToFile,
  getNodeStorageInfo,
  getStoragePath,
} from './node'

// Electron utilities - TODO: Re-enable when Electron integration is ready
// export {
//   downloadElectronVault,
//   exportElectronVaultToFile,
//   getElectronHandlers,
//   getElectronProcessType,
//   setupElectronIPC,
// } from './electron'

// Chrome extension utilities
export {
  isServiceWorkerAlive,
  keepServiceWorkerAlive,
  onChromeStorageChanged,
  sendChromeMessage,
  setupChromeMessageHandlers,
} from './chrome'
