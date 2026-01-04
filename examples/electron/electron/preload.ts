import { contextBridge, ipcRenderer } from 'electron'

// Expose type-safe API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // SDK lifecycle
  initialize: () => ipcRenderer.invoke('sdk:initialize'),
  getServerStatus: () => ipcRenderer.invoke('sdk:getServerStatus'),
  getChainList: () => ipcRenderer.invoke('sdk:getChainList'),

  // Vault management
  listVaults: () => ipcRenderer.invoke('vault:list'),
  createFastVault: (options: { name: string; password: string; email: string }) =>
    ipcRenderer.invoke('vault:createFast', options),
  verifyVault: (vaultId: string, code: string) => ipcRenderer.invoke('vault:verify', vaultId, code),
  createSecureVault: (options: { name: string; password?: string; devices: number; threshold?: number }) =>
    ipcRenderer.invoke('vault:createSecure', options),
  importVault: (content: string, password?: string) => ipcRenderer.invoke('vault:import', content, password),
  isVaultEncrypted: (content: string) => ipcRenderer.invoke('vault:isEncrypted', content),
  deleteVault: (vaultId: string) => ipcRenderer.invoke('vault:delete', vaultId),
  setActiveVault: (vaultId: string | null) => ipcRenderer.invoke('vault:setActive', vaultId),
  getActiveVault: () => ipcRenderer.invoke('vault:getActive'),

  // Vault operations
  getAddress: (vaultId: string, chain: string) => ipcRenderer.invoke('vault:getAddress', vaultId, chain),
  getAllAddresses: (vaultId: string) => ipcRenderer.invoke('vault:getAllAddresses', vaultId),
  getBalance: (vaultId: string, chain: string, tokenId?: string) =>
    ipcRenderer.invoke('vault:getBalance', vaultId, chain, tokenId),
  getChains: (vaultId: string) => ipcRenderer.invoke('vault:getChains', vaultId),
  addChain: (vaultId: string, chain: string) => ipcRenderer.invoke('vault:addChain', vaultId, chain),
  removeChain: (vaultId: string, chain: string) => ipcRenderer.invoke('vault:removeChain', vaultId, chain),
  getTokens: (vaultId: string, chain: string) => ipcRenderer.invoke('vault:getTokens', vaultId, chain),
  addToken: (vaultId: string, chain: string, token: any) => ipcRenderer.invoke('vault:addToken', vaultId, chain, token),
  removeToken: (vaultId: string, chain: string, tokenId: string) =>
    ipcRenderer.invoke('vault:removeToken', vaultId, chain, tokenId),

  // Portfolio
  setCurrency: (vaultId: string, currency: string) => ipcRenderer.invoke('vault:setCurrency', vaultId, currency),
  getValue: (vaultId: string, chain: string, tokenId?: string, currency?: string) =>
    ipcRenderer.invoke('vault:getValue', vaultId, chain, tokenId, currency),
  getTotalValue: (vaultId: string, currency?: string) => ipcRenderer.invoke('vault:getTotalValue', vaultId, currency),

  // Swap
  getSupportedSwapChains: () => ipcRenderer.invoke('vault:getSupportedSwapChains'),
  isSwapSupported: (fromChain: string, toChain: string) =>
    ipcRenderer.invoke('vault:isSwapSupported', fromChain, toChain),
  getSwapQuote: (vaultId: string, params: any) => ipcRenderer.invoke('vault:getSwapQuote', vaultId, params),
  prepareSwapTx: (vaultId: string, params: any) => ipcRenderer.invoke('vault:prepareSwapTx', vaultId, params),

  // Transactions
  prepareSendTx: (vaultId: string, params: { coin: any; receiver: string; amount: string; memo?: string }) =>
    ipcRenderer.invoke('vault:prepareSendTx', vaultId, params),
  extractMessageHashes: (vaultId: string, keysignPayload: any) =>
    ipcRenderer.invoke('vault:extractMessageHashes', vaultId, keysignPayload),
  sign: (vaultId: string, payload: any) => ipcRenderer.invoke('vault:sign', vaultId, payload),
  broadcastTx: (vaultId: string, params: { chain: string; keysignPayload: any; signature: any }) =>
    ipcRenderer.invoke('vault:broadcastTx', vaultId, params),

  // Export
  exportVault: (vaultId: string, options?: { password?: string; includeSigners?: boolean }) =>
    ipcRenderer.invoke('vault:export', vaultId, options),
  renameVault: (vaultId: string, newName: string) => ipcRenderer.invoke('vault:rename', vaultId, newName),

  // Dialogs
  openFileDialog: (options?: {
    title?: string
    filters?: Array<{ name: string; extensions: string[] }>
    multiSelections?: boolean
  }) => ipcRenderer.invoke('dialog:openFile', options),
  saveFileDialog: (options?: {
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }) => ipcRenderer.invoke('dialog:saveFile', options),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),

  // Password handling
  resolvePassword: (requestId: string, password: string) => ipcRenderer.invoke('password:resolve', requestId, password),
  rejectPassword: (requestId: string) => ipcRenderer.invoke('password:reject', requestId),

  // Utilities
  getTxExplorerUrl: (chain: string, txHash: string) => ipcRenderer.invoke('sdk:getTxExplorerUrl', chain, txHash),

  // Event listeners (return cleanup function)
  onPasswordRequired: (callback: (data: { requestId: string; vaultId: string; vaultName?: string }) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { requestId: string; vaultId: string; vaultName?: string }
    ) => callback(data)
    ipcRenderer.on('password-required', handler)
    return () => ipcRenderer.removeListener('password-required', handler)
  },
  onVaultCreationProgress: (callback: (data: { step: any }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { step: any }) => callback(data)
    ipcRenderer.on('vault:creationProgress', handler)
    return () => ipcRenderer.removeListener('vault:creationProgress', handler)
  },
  onQrCodeReady: (callback: (data: { qrPayload: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { qrPayload: string }) => callback(data)
    ipcRenderer.on('vault:qrCodeReady', handler)
    return () => ipcRenderer.removeListener('vault:qrCodeReady', handler)
  },
  onDeviceJoined: (callback: (data: { deviceId: string; totalJoined: number; required: number }) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { deviceId: string; totalJoined: number; required: number }
    ) => callback(data)
    ipcRenderer.on('vault:deviceJoined', handler)
    return () => ipcRenderer.removeListener('vault:deviceJoined', handler)
  },
  onSigningProgress: (callback: (data: { step: any }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { step: any }) => callback(data)
    ipcRenderer.on('vault:signingProgress', handler)
    return () => ipcRenderer.removeListener('vault:signingProgress', handler)
  },
  onBalanceUpdated: (callback: (data: { chain: string; tokenId?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { chain: string; tokenId?: string }) => callback(data)
    ipcRenderer.on('vault:balanceUpdated', handler)
    return () => ipcRenderer.removeListener('vault:balanceUpdated', handler)
  },
  onChainChanged: (callback: (data: { chain: string; action: 'added' | 'removed' }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { chain: string; action: 'added' | 'removed' }) =>
      callback(data)
    ipcRenderer.on('vault:chainChanged', handler)
    return () => ipcRenderer.removeListener('vault:chainChanged', handler)
  },
  onTransactionBroadcast: (callback: (data: { chain: string; txHash: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { chain: string; txHash: string }) => callback(data)
    ipcRenderer.on('vault:transactionBroadcast', handler)
    return () => ipcRenderer.removeListener('vault:transactionBroadcast', handler)
  },
  onError: (callback: (data: { message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { message: string }) => callback(data)
    ipcRenderer.on('vault:error', handler)
    return () => ipcRenderer.removeListener('vault:error', handler)
  },
  onVaultChanged: (callback: (data: { vault: any | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { vault: any | null }) => callback(data)
    ipcRenderer.on('vault:changed', handler)
    return () => ipcRenderer.removeListener('vault:changed', handler)
  },
})
