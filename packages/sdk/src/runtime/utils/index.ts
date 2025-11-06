// Browser utilities
export {
  downloadVault,
  getBrowserStorageInfo,
  isBrowserStorageLow,
  requestPersistentStorage,
  isPersistentStorage,
  uploadVaultFile,
} from './browser'

// Node.js utilities
export {
  exportVaultToFile,
  importVaultFromFile,
  getStoragePath,
  getNodeStorageInfo,
  ensureDirectory,
} from './node'

// Electron utilities
export {
  setupElectronIPC,
  getElectronHandlers,
  getElectronProcessType,
  exportElectronVaultToFile,
  downloadElectronVault,
} from './electron'

// Chrome extension utilities
export {
  setupChromeMessageHandlers,
  sendChromeMessage,
  keepServiceWorkerAlive,
  isServiceWorkerAlive,
  onChromeStorageChanged,
} from './chrome'
