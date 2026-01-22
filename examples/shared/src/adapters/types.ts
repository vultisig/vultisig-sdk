import type {
  BalanceResult,
  BroadcastParams,
  CreateFastVaultFromSeedphraseOptions,
  CreateFastVaultOptions,
  CreateSecureVaultFromSeedphraseOptions,
  CreateSecureVaultOptions,
  CreateSecureVaultResult,
  DeviceJoinedData,
  ExportOptions,
  FiatCurrency,
  GetSwapQuoteParams,
  JoinSecureVaultOptions,
  JoinSecureVaultResult,
  PrepareSwapParams,
  ProgressStep,
  SaveFileOptions,
  SeedphraseValidation,
  SelectedFile,
  SelectFilesOptions,
  SelectFilesResult,
  SendTxParams,
  SwapQuoteResult,
  SwapResult,
  TokenInfo,
  ValueResult,
  VaultInfo,
} from '../types'

/**
 * SDK Adapter interface - abstracts SDK access for browser and electron
 */
export type ISDKAdapter = {
  // ===== Vault Management =====
  listVaults(): Promise<VaultInfo[]>

  createFastVault(options: CreateFastVaultOptions): Promise<{ vaultId: string }>

  verifyVault(vaultId: string, code: string): Promise<VaultInfo>

  resendVaultVerification(options: { vaultId: string; email: string; password: string }): Promise<void>

  createSecureVault(options: CreateSecureVaultOptions): Promise<CreateSecureVaultResult>

  importVault(content: string, password?: string): Promise<VaultInfo>

  isVaultEncrypted(content: string): Promise<boolean>

  // ===== Seedphrase Vault Creation =====
  validateSeedphrase(mnemonic: string): Promise<SeedphraseValidation>

  createFastVaultFromSeedphrase(options: CreateFastVaultFromSeedphraseOptions): Promise<{ vaultId: string }>

  createSecureVaultFromSeedphrase(options: CreateSecureVaultFromSeedphraseOptions): Promise<CreateSecureVaultResult>

  joinSecureVault(qrPayload: string, options: JoinSecureVaultOptions): Promise<JoinSecureVaultResult>

  deleteVault(vaultId: string): Promise<void>

  // ===== Vault Operations =====
  getAddress(vaultId: string, chain: string): Promise<string>

  getAllAddresses(vaultId: string): Promise<Record<string, string>>

  addChain(vaultId: string, chain: string): Promise<void>

  removeChain(vaultId: string, chain: string): Promise<void>

  // ===== Tokens =====
  getTokens(vaultId: string, chain: string): Promise<TokenInfo[]>

  addToken(vaultId: string, chain: string, token: TokenInfo): Promise<void>

  removeToken(vaultId: string, chain: string, tokenId: string): Promise<void>

  // ===== Balance & Portfolio =====
  getBalance(vaultId: string, chain: string, tokenId?: string): Promise<BalanceResult>

  setCurrency(vaultId: string, currency: FiatCurrency): Promise<void>

  getValue(vaultId: string, chain: string, tokenId?: string, currency?: FiatCurrency): Promise<ValueResult>

  getTotalValue(vaultId: string, currency?: FiatCurrency): Promise<ValueResult>

  // ===== Swap =====
  getSupportedSwapChains(vaultId: string): Promise<string[]>

  isSwapSupported(vaultId: string, fromChain: string, toChain: string): Promise<boolean>

  getSwapQuote(vaultId: string, params: GetSwapQuoteParams): Promise<SwapQuoteResult>

  prepareSwapTx(vaultId: string, params: PrepareSwapParams): Promise<SwapResult>

  // ===== Transactions =====
  prepareSendTx(vaultId: string, params: SendTxParams): Promise<unknown>

  extractMessageHashes(vaultId: string, keysignPayload: unknown): Promise<string[]>

  sign(vaultId: string, payload: unknown): Promise<unknown>

  broadcastTx(vaultId: string, params: BroadcastParams): Promise<string>

  // ===== Export/Misc =====
  exportVault(vaultId: string, options?: ExportOptions): Promise<string>

  renameVault(vaultId: string, newName: string): Promise<void>

  getTxExplorerUrl(chain: string, txHash: string): Promise<string>

  getChainList(): Promise<string[]>

  // ===== Active Vault =====
  getActiveVault(): Promise<VaultInfo | null>

  setActiveVault(vaultId: string): Promise<void>

  // ===== Events =====
  /** Subscribe to vault creation progress */
  onProgress(callback: (step: ProgressStep) => void): () => void

  /** Subscribe to QR code ready events (secure vault creation/signing) */
  onQrCodeReady(callback: (qrPayload: string) => void): () => void

  /** Subscribe to device joined events */
  onDeviceJoined(callback: (data: DeviceJoinedData) => void): () => void

  /** Subscribe to signing progress */
  onSigningProgress(callback: (step: ProgressStep) => void): () => void

  /** Subscribe to vault changed events */
  onVaultChanged(callback: (vault: VaultInfo | null) => void): () => void

  /** Subscribe to balance updated events */
  onBalanceUpdated(callback: (data: { chain: string; tokenId?: string }) => void): () => void

  /** Subscribe to chain added/removed events */
  onChainChanged(callback: (data: { chain: string; action: 'added' | 'removed' }) => void): () => void

  /** Subscribe to transaction broadcast events */
  onTransactionBroadcast(callback: (data: { chain: string; txHash: string }) => void): () => void

  /** Subscribe to error events */
  onError(callback: (error: Error) => void): () => void
}

/**
 * File Adapter interface - abstracts file operations for browser and electron
 */
export type IFileAdapter = {
  /** Open a file picker dialog */
  selectFiles(options?: SelectFilesOptions): Promise<SelectFilesResult>

  /** Read content from a selected file */
  readFile(file: SelectedFile): Promise<string>

  /** Save content to a file (shows save dialog) */
  saveFile(content: string, options?: SaveFileOptions): Promise<boolean>
}
