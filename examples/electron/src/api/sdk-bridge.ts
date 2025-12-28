// Type-safe wrapper around the Electron IPC bridge

import type { BalanceInfo, PasswordRequest, ProgressStep, VaultInfo } from '../types'

// Get the typed API from the window object
function getAPI() {
  if (typeof window === 'undefined' || !window.electronAPI) {
    throw new Error('Electron API not available')
  }
  return window.electronAPI
}

// SDK Operations
export const sdk = {
  initialize: () => getAPI().initialize(),
  getServerStatus: () => getAPI().getServerStatus(),
  getChainList: () => getAPI().getChainList(),
}

// Vault Operations
export const vault = {
  list: (): Promise<VaultInfo[]> => getAPI().listVaults(),

  createFast: (options: { name: string; password: string; email: string }): Promise<{ vaultId: string }> =>
    getAPI().createFastVault(options),

  verify: (vaultId: string, code: string): Promise<VaultInfo> => getAPI().verifyVault(vaultId, code),

  createSecure: (options: {
    name: string
    password?: string
    devices: number
    threshold?: number
  }): Promise<{ vault: VaultInfo; sessionId: string }> => getAPI().createSecureVault(options),

  import: (content: string, password?: string): Promise<VaultInfo> => getAPI().importVault(content, password),

  isEncrypted: (content: string): Promise<boolean> => getAPI().isVaultEncrypted(content),

  delete: (vaultId: string): Promise<void> => getAPI().deleteVault(vaultId),

  setActive: (vaultId: string | null): Promise<void> => getAPI().setActiveVault(vaultId),

  getActive: (): Promise<VaultInfo | null> => getAPI().getActiveVault(),

  getAddress: (vaultId: string, chain: string): Promise<string> => getAPI().getAddress(vaultId, chain),

  getAllAddresses: (vaultId: string): Promise<Record<string, string>> => getAPI().getAllAddresses(vaultId),

  getBalance: (vaultId: string, chain: string, tokenId?: string): Promise<BalanceInfo> =>
    getAPI().getBalance(vaultId, chain, tokenId),

  getChains: (vaultId: string): Promise<string[]> => getAPI().getChains(vaultId),

  addChain: (vaultId: string, chain: string): Promise<void> => getAPI().addChain(vaultId, chain),

  removeChain: (vaultId: string, chain: string): Promise<void> => getAPI().removeChain(vaultId, chain),

  getTokens: (vaultId: string, chain: string): Promise<any[]> => getAPI().getTokens(vaultId, chain),

  // Transactions
  prepareSendTx: (vaultId: string, params: { coin: any; receiver: string; amount: string; memo?: string }) =>
    getAPI().prepareSendTx(vaultId, params),

  extractMessageHashes: (vaultId: string, keysignPayload: any): Promise<string[]> =>
    getAPI().extractMessageHashes(vaultId, keysignPayload),

  sign: (vaultId: string, payload: any) => getAPI().sign(vaultId, payload),

  broadcastTx: (vaultId: string, params: { chain: string; keysignPayload: any; signature: any }): Promise<string> =>
    getAPI().broadcastTx(vaultId, params),

  getTxExplorerUrl: (chain: string, txHash: string): Promise<string> => getAPI().getTxExplorerUrl(chain, txHash),

  // Export
  export: (vaultId: string, options?: { password?: string; includeSigners?: boolean }): Promise<string> =>
    getAPI().exportVault(vaultId, options),

  rename: (vaultId: string, newName: string): Promise<void> => getAPI().renameVault(vaultId, newName),
}

// Dialog operations
export const dialog = {
  openFile: (options?: {
    title?: string
    filters?: Array<{ name: string; extensions: string[] }>
    multiSelections?: boolean
  }) => getAPI().openFileDialog(options),
  saveFile: (options?: {
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }) => getAPI().saveFileDialog(options),
  readFile: (filePath: string) => getAPI().readFile(filePath),
  writeFile: (filePath: string, content: string) => getAPI().writeFile(filePath, content),
}

// Password operations
export const password = {
  resolve: (requestId: string, password: string) => getAPI().resolvePassword(requestId, password),
  reject: (requestId: string) => getAPI().rejectPassword(requestId),
}

// Utility operations
export const utils = {
  getTxExplorerUrl: (chain: string, txHash: string): Promise<string> => getAPI().getTxExplorerUrl(chain, txHash),
}

// Event subscriptions
export const events = {
  onPasswordRequired: (callback: (data: PasswordRequest) => void) => getAPI().onPasswordRequired(callback),

  onVaultCreationProgress: (callback: (data: { step: ProgressStep }) => void) =>
    getAPI().onVaultCreationProgress(callback),

  onQrCodeReady: (callback: (data: { qrPayload: string }) => void) => getAPI().onQrCodeReady(callback),

  onDeviceJoined: (callback: (data: { deviceId: string; totalJoined: number; required: number }) => void) =>
    getAPI().onDeviceJoined(callback),

  onSigningProgress: (callback: (data: { step: ProgressStep }) => void) => getAPI().onSigningProgress(callback),
}
