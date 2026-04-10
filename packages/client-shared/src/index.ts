export { executeAuthLogout, executeAuthSetup, executeAuthStatus } from './auth-setup.js'
export * as descriptions from './descriptions.js'
export { getConfigPath, loadConfig, saveConfig, type VaultEntry, type VsigConfig } from './config-store.js'
export {
  _resetAll,
  clearCredentials,
  getDecryptionPassword,
  getServerPassword,
  getStoredServerPassword,
  isUsingFileFallback,
  setDecryptionPassword,
  setFilePassphrase,
  setServerPassword,
} from './credential-store.js'
export { discoverVaultFiles, SEARCH_DIRS } from './vault-discovery.js'
