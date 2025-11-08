// Browser utilities
export {
  downloadVault,
  getBrowserStorageInfo,
  isBrowserStorageLow,
  isPersistentStorage,
  requestPersistentStorage,
  uploadVaultFile,
} from './browser'

// Node.js utilities
export {
  ensureDirectory,
  exportVaultToFile,
  getNodeStorageInfo,
  getStoragePath,
  importVaultFromFile,
} from './node'

// Electron utilities
export {
  downloadElectronVault,
  exportElectronVaultToFile,
  getElectronHandlers,
  getElectronProcessType,
  setupElectronIPC,
} from './electron'

// Chrome extension utilities
export {
  isServiceWorkerAlive,
  keepServiceWorkerAlive,
  onChromeStorageChanged,
  sendChromeMessage,
  setupChromeMessageHandlers,
} from './chrome'
