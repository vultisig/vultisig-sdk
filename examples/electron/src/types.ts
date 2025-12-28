// Extend the Window interface for Electron API
declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    electronAPI: {
      // SDK lifecycle
      initialize: () => Promise<{ initialized: boolean }>
      getServerStatus: () => Promise<any>
      getChainList: () => Promise<string[]>

      // Vault management
      listVaults: () => Promise<VaultInfo[]>
      createFastVault: (options: { name: string; password: string; email: string }) => Promise<{ vaultId: string }>
      verifyVault: (vaultId: string, code: string) => Promise<VaultInfo>
      createSecureVault: (options: {
        name: string
        password?: string
        devices: number
        threshold?: number
      }) => Promise<{ vault: VaultInfo; sessionId: string }>
      importVault: (content: string, password?: string) => Promise<VaultInfo>
      isVaultEncrypted: (content: string) => Promise<boolean>
      deleteVault: (vaultId: string) => Promise<void>
      setActiveVault: (vaultId: string | null) => Promise<void>
      getActiveVault: () => Promise<VaultInfo | null>

      // Vault operations
      getAddress: (vaultId: string, chain: string) => Promise<string>
      getAllAddresses: (vaultId: string) => Promise<Record<string, string>>
      getBalance: (vaultId: string, chain: string, tokenId?: string) => Promise<BalanceInfo>
      getChains: (vaultId: string) => Promise<string[]>
      addChain: (vaultId: string, chain: string) => Promise<void>
      removeChain: (vaultId: string, chain: string) => Promise<void>
      getTokens: (vaultId: string, chain: string) => Promise<any[]>

      // Transactions
      prepareSendTx: (
        vaultId: string,
        params: { coin: any; receiver: string; amount: string; memo?: string }
      ) => Promise<any>
      extractMessageHashes: (vaultId: string, keysignPayload: any) => Promise<string[]>
      sign: (vaultId: string, payload: any) => Promise<any>
      broadcastTx: (vaultId: string, params: { chain: string; keysignPayload: any; signature: any }) => Promise<string>

      // Export
      exportVault: (vaultId: string, options?: { password?: string; includeSigners?: boolean }) => Promise<string>
      renameVault: (vaultId: string, newName: string) => Promise<void>

      // Dialogs
      openFileDialog: (options?: {
        title?: string
        filters?: Array<{ name: string; extensions: string[] }>
        multiSelections?: boolean
      }) => Promise<{ canceled: boolean; filePaths: string[] }>
      saveFileDialog: (options?: {
        title?: string
        defaultPath?: string
        filters?: Array<{ name: string; extensions: string[] }>
      }) => Promise<{ canceled: boolean; filePath?: string }>
      readFile: (filePath: string) => Promise<string>
      writeFile: (filePath: string, content: string) => Promise<void>

      // Password handling
      resolvePassword: (requestId: string, password: string) => Promise<void>
      rejectPassword: (requestId: string) => Promise<void>

      // Utilities
      getTxExplorerUrl: (chain: string, txHash: string) => Promise<string>

      // Event listeners (return cleanup function)
      onPasswordRequired: (callback: (data: PasswordRequest) => void) => () => void
      onVaultCreationProgress: (callback: (data: { step: ProgressStep }) => void) => () => void
      onQrCodeReady: (callback: (data: { qrPayload: string }) => void) => () => void
      onDeviceJoined: (
        callback: (data: { deviceId: string; totalJoined: number; required: number }) => void
      ) => () => void
      onSigningProgress: (callback: (data: { step: ProgressStep }) => void) => () => void
    }
  }
}

// App state types
export type VaultInfo = {
  id: string
  name: string
  type: 'fast' | 'secure'
  chains: string[]
  threshold?: number
}

export type BalanceInfo = {
  raw: string
  formatted: string
  decimals: number
}

export type PasswordRequest = {
  requestId: string
  vaultId: string
  vaultName?: string
}

export type ProgressStep = {
  message: string
  progress: number
  phase?: string
}

export type EventLogEntry = {
  id: string
  type: 'info' | 'success' | 'error' | 'warning' | 'vault' | 'balance' | 'transaction' | 'signing' | 'chain'
  source: 'sdk' | 'vault' | 'ipc' | 'ui'
  message: string
  timestamp: Date
  data?: any
}

export type AppState = {
  openVaults: Map<string, VaultInfo>
  activeVaultId: string | null
  events: EventLogEntry[]
  isLoading: boolean
  error: string | null
  availableChains: string[]
}

export {}
