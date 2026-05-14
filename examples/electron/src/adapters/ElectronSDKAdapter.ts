import type {
  BalanceResult,
  BroadcastParams,
  CoinInfo,
  CreateFastVaultFromSeedphraseOptions,
  CreateFastVaultOptions,
  CreateSecureVaultFromSeedphraseOptions,
  CreateSecureVaultOptions,
  CreateSecureVaultResult,
  DeviceJoinedData,
  DiscountTier,
  ExportOptions,
  FiatCurrency,
  GetSwapQuoteParams,
  ISDKAdapter,
  JoinSecureVaultOptions,
  JoinSecureVaultResult,
  MaxSendAmountResult,
  PrepareSwapParams,
  ProgressStep,
  SeedphraseValidation,
  SendTxParams,
  SwapQuoteResult,
  SwapResult,
  TokenInfo,
  TxStatusResult,
  ValueResult,
  VaultInfo,
} from '@vultisig/examples-shared'
import { SDKAdapterEventSubscriptionBase } from '@vultisig/examples-shared/adapters'

// Declare the window.electronAPI type
declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    electronAPI: {
      // SDK lifecycle
      initialize(): Promise<void>
      getServerStatus(): Promise<{ status: string }>
      getChainList(): Promise<string[]>

      // Vault management
      listVaults(): Promise<VaultInfo[]>
      createFastVault(options: {
        name: string
        password: string
        email: string
        createTimeoutMs?: number
      }): Promise<{ vaultId: string }>
      verifyVault(vaultId: string, code: string): Promise<VaultInfo>
      resendVaultVerification(options: { vaultId: string; email: string; password: string }): Promise<void>
      createSecureVault(options: {
        name: string
        password?: string
        devices: number
        threshold?: number
      }): Promise<CreateSecureVaultResult>
      importVault(content: string, password?: string): Promise<VaultInfo>
      isVaultEncrypted(content: string): Promise<boolean>
      deleteVault(vaultId: string): Promise<void>
      setActiveVault(vaultId: string | null): Promise<void>
      getActiveVault(): Promise<VaultInfo | null>

      // Seedphrase vault creation
      validateSeedphrase(mnemonic: string): Promise<SeedphraseValidation>
      createFastVaultFromSeedphrase(options: {
        mnemonic: string
        name: string
        password: string
        email: string
        discoverChains?: boolean
        chains?: string[]
        usePhantomSolanaPath?: boolean
        tssBatching?: boolean
        importTimeoutMs?: number
      }): Promise<{ vaultId: string }>
      createSecureVaultFromSeedphrase(options: {
        mnemonic: string
        name: string
        password?: string
        devices: number
        threshold?: number
        discoverChains?: boolean
        chains?: string[]
        usePhantomSolanaPath?: boolean
        tssBatching?: boolean
      }): Promise<CreateSecureVaultResult>
      joinSecureVault(
        qrPayload: string,
        options: {
          mnemonic?: string
          password?: string
          devices?: number
        }
      ): Promise<JoinSecureVaultResult>

      // Vault operations
      getAddress(vaultId: string, chain: string): Promise<string>
      getAllAddresses(vaultId: string): Promise<Record<string, string>>
      getBalance(vaultId: string, chain: string, tokenId?: string): Promise<BalanceResult>
      getChains(vaultId: string): Promise<string[]>
      addChain(vaultId: string, chain: string): Promise<void>
      removeChain(vaultId: string, chain: string): Promise<void>
      getTokens(vaultId: string, chain: string): Promise<TokenInfo[]>
      addToken(vaultId: string, chain: string, token: TokenInfo): Promise<void>
      removeToken(vaultId: string, chain: string, tokenId: string): Promise<void>

      // Portfolio
      setCurrency(vaultId: string, currency: string): Promise<void>
      getValue(vaultId: string, chain: string, tokenId?: string, currency?: string): Promise<ValueResult>
      getTotalValue(vaultId: string, currency?: string): Promise<ValueResult>
      refreshPortfolioPrices(vaultId: string): Promise<void>

      // Discount tier
      getDiscountTier(vaultId: string): Promise<DiscountTier>
      updateDiscountTier(vaultId: string): Promise<DiscountTier>

      // Swap
      getSupportedSwapChains(): Promise<string[]>
      isSwapSupported(fromChain: string, toChain: string): Promise<boolean>
      getSwapQuote(vaultId: string, params: GetSwapQuoteParams): Promise<SwapQuoteResult>
      prepareSwapTx(vaultId: string, params: PrepareSwapParams): Promise<SwapResult>

      // Transactions
      prepareSendTx(
        vaultId: string,
        params: { coin: unknown; receiver: string; amount: string; memo?: string }
      ): Promise<unknown>
      getMaxSendAmount(vaultId: string, params: unknown): Promise<MaxSendAmountResult>
      extractMessageHashes(vaultId: string, keysignPayload: unknown): Promise<string[]>
      sign(vaultId: string, payload: unknown): Promise<unknown>
      broadcastTx(
        vaultId: string,
        params: { chain: string; keysignPayload: unknown; signature: unknown }
      ): Promise<string>
      getTxStatus(vaultId: string, chain: string, txHash: string): Promise<TxStatusResult>

      // Export
      exportVault(vaultId: string, options?: { password?: string; includeSigners?: boolean }): Promise<string>
      renameVault(vaultId: string, newName: string): Promise<void>

      // Utilities
      getTxExplorerUrl(chain: string, txHash: string): Promise<string>

      // Dialogs
      openFileDialog(options?: {
        title?: string
        filters?: Array<{ name: string; extensions: string[] }>
        multiSelections?: boolean
      }): Promise<{ canceled: boolean; filePaths: string[] }>
      saveFileDialog(options?: {
        title?: string
        defaultPath?: string
        filters?: Array<{ name: string; extensions: string[] }>
      }): Promise<{ canceled: boolean; filePath?: string }>
      readFile(filePath: string): Promise<string>
      writeFile(filePath: string, content: string): Promise<void>

      // Password handling
      resolvePassword(requestId: string, password: string): Promise<void>
      rejectPassword(requestId: string): Promise<void>

      // Event listeners
      onPasswordRequired(
        callback: (data: { requestId: string; vaultId: string; vaultName?: string }) => void
      ): () => void
      onVaultCreationProgress(callback: (data: { step: ProgressStep }) => void): () => void
      onQrCodeReady(callback: (data: { qrPayload: string }) => void): () => void
      onDeviceJoined(callback: (data: { deviceId: string; totalJoined: number; required: number }) => void): () => void
      onSigningProgress(callback: (data: { step: ProgressStep }) => void): () => void
      onBalanceUpdated(callback: (data: { chain: string; tokenId?: string }) => void): () => void
      onChainChanged(callback: (data: { chain: string; action: 'added' | 'removed' }) => void): () => void
      onTransactionBroadcast(callback: (data: { chain: string; txHash: string }) => void): () => void
      onTransactionConfirmed(callback: (data: { chain: string; txHash: string }) => void): () => void
      onTransactionFailed(callback: (data: { chain: string; txHash: string }) => void): () => void
      onError(callback: (data: { message: string }) => void): () => void
      onVaultChanged(callback: (data: { vault: VaultInfo | null }) => void): () => void
    }
  }
}

/**
 * Electron SDK Adapter - wraps IPC bridge for electron environment
 */
export class ElectronSDKAdapter extends SDKAdapterEventSubscriptionBase implements ISDKAdapter {
  private async withOperationCallbacks<T>(
    callbacks: {
      onProgress?: (step: ProgressStep) => void
      onQRCodeReady?: (qrPayload: string) => void
      onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
    },
    operation: () => Promise<T>
  ): Promise<T> {
    const progressCallback = callbacks.onProgress ? (step: ProgressStep) => callbacks.onProgress?.(step) : undefined
    const qrCallback = callbacks.onQRCodeReady ? (qrPayload: string) => callbacks.onQRCodeReady?.(qrPayload) : undefined
    const deviceCallback = callbacks.onDeviceJoined
      ? ({ deviceId, totalJoined, required }: DeviceJoinedData) =>
          callbacks.onDeviceJoined?.(deviceId, totalJoined, required)
      : undefined

    if (progressCallback) this.progressCallbacks.add(progressCallback)
    if (qrCallback) this.qrCallbacks.add(qrCallback)
    if (deviceCallback) this.deviceCallbacks.add(deviceCallback)

    try {
      return await operation()
    } finally {
      if (progressCallback) this.progressCallbacks.delete(progressCallback)
      if (qrCallback) this.qrCallbacks.delete(qrCallback)
      if (deviceCallback) this.deviceCallbacks.delete(deviceCallback)
    }
  }

  constructor() {
    super()
    // Subscribe to IPC events and forward to callbacks
    window.electronAPI.onVaultCreationProgress(({ step }) => {
      this.emitProgress(step)
    })

    window.electronAPI.onQrCodeReady(({ qrPayload }) => {
      this.emitQrCodeReady(qrPayload)
    })

    window.electronAPI.onDeviceJoined(({ deviceId, totalJoined, required }) => {
      this.emitDeviceJoined({ deviceId, totalJoined, required })
    })

    window.electronAPI.onSigningProgress(({ step }) => {
      this.emitSigningProgress(step)
    })

    window.electronAPI.onBalanceUpdated(data => {
      this.emitBalanceUpdated(data)
    })

    window.electronAPI.onChainChanged(data => {
      this.emitChainChanged(data)
    })

    window.electronAPI.onTransactionBroadcast(data => {
      this.emitTransactionBroadcast(data)
    })

    window.electronAPI.onTransactionConfirmed(data => {
      this.emitTransactionConfirmed(data)
    })

    window.electronAPI.onTransactionFailed(data => {
      this.emitTransactionFailed(data)
    })

    window.electronAPI.onError(({ message }) => {
      this.emitError(new Error(message))
    })

    window.electronAPI.onVaultChanged(({ vault }) => {
      this.emitVaultChanged(vault)
    })
  }

  // ===== Vault Management =====
  async listVaults(): Promise<VaultInfo[]> {
    return window.electronAPI.listVaults()
  }

  async createFastVault(options: CreateFastVaultOptions): Promise<{ vaultId: string }> {
    return this.withOperationCallbacks(options, () =>
      window.electronAPI.createFastVault({
        name: options.name,
        password: options.password,
        email: options.email,
        createTimeoutMs: options.createTimeoutMs,
      })
    )
  }

  async verifyVault(vaultId: string, code: string): Promise<VaultInfo> {
    return window.electronAPI.verifyVault(vaultId, code)
  }

  async resendVaultVerification(options: { vaultId: string; email: string; password: string }): Promise<void> {
    return window.electronAPI.resendVaultVerification(options)
  }

  async createSecureVault(options: CreateSecureVaultOptions): Promise<CreateSecureVaultResult> {
    return this.withOperationCallbacks(options, () =>
      window.electronAPI.createSecureVault({
        name: options.name,
        password: options.password,
        devices: options.devices,
        threshold: options.threshold,
      })
    )
  }

  async importVault(content: string, password?: string): Promise<VaultInfo> {
    return window.electronAPI.importVault(content, password)
  }

  async isVaultEncrypted(content: string): Promise<boolean> {
    return window.electronAPI.isVaultEncrypted(content)
  }

  async deleteVault(vaultId: string): Promise<void> {
    return window.electronAPI.deleteVault(vaultId)
  }

  // ===== Seedphrase Vault Creation =====
  async validateSeedphrase(mnemonic: string): Promise<SeedphraseValidation> {
    return window.electronAPI.validateSeedphrase(mnemonic)
  }

  async createFastVaultFromSeedphrase(options: CreateFastVaultFromSeedphraseOptions): Promise<{ vaultId: string }> {
    return this.withOperationCallbacks(options, () =>
      window.electronAPI.createFastVaultFromSeedphrase({
        mnemonic: options.mnemonic,
        name: options.name,
        password: options.password,
        email: options.email,
        discoverChains: options.discoverChains,
        chains: options.chains,
        usePhantomSolanaPath: options.usePhantomSolanaPath,
        tssBatching: options.tssBatching,
        importTimeoutMs: options.importTimeoutMs,
      })
    )
  }

  async createSecureVaultFromSeedphrase(
    options: CreateSecureVaultFromSeedphraseOptions
  ): Promise<CreateSecureVaultResult> {
    return this.withOperationCallbacks(options, () =>
      window.electronAPI.createSecureVaultFromSeedphrase({
        mnemonic: options.mnemonic,
        name: options.name,
        password: options.password,
        devices: options.devices,
        threshold: options.threshold,
        discoverChains: options.discoverChains,
        chains: options.chains,
        usePhantomSolanaPath: options.usePhantomSolanaPath,
        tssBatching: options.tssBatching,
      })
    )
  }

  async joinSecureVault(qrPayload: string, options: JoinSecureVaultOptions): Promise<JoinSecureVaultResult> {
    return this.withOperationCallbacks(options, () =>
      window.electronAPI.joinSecureVault(qrPayload, {
        mnemonic: options.mnemonic,
        password: options.password,
        devices: options.devices ?? 2,
      })
    )
  }

  // ===== Vault Operations =====
  async getAddress(vaultId: string, chain: string): Promise<string> {
    return window.electronAPI.getAddress(vaultId, chain)
  }

  async getAllAddresses(vaultId: string): Promise<Record<string, string>> {
    return window.electronAPI.getAllAddresses(vaultId)
  }

  async addChain(vaultId: string, chain: string): Promise<void> {
    return window.electronAPI.addChain(vaultId, chain)
  }

  async removeChain(vaultId: string, chain: string): Promise<void> {
    return window.electronAPI.removeChain(vaultId, chain)
  }

  // ===== Tokens =====
  async getTokens(vaultId: string, chain: string): Promise<TokenInfo[]> {
    return window.electronAPI.getTokens(vaultId, chain)
  }

  async addToken(vaultId: string, chain: string, token: TokenInfo): Promise<void> {
    return window.electronAPI.addToken(vaultId, chain, token)
  }

  async removeToken(vaultId: string, chain: string, tokenId: string): Promise<void> {
    return window.electronAPI.removeToken(vaultId, chain, tokenId)
  }

  // ===== Balance & Portfolio =====
  async getBalance(vaultId: string, chain: string, tokenId?: string): Promise<BalanceResult> {
    return window.electronAPI.getBalance(vaultId, chain, tokenId)
  }

  async setCurrency(vaultId: string, currency: FiatCurrency): Promise<void> {
    return window.electronAPI.setCurrency(vaultId, currency)
  }

  async getValue(vaultId: string, chain: string, tokenId?: string, currency?: FiatCurrency): Promise<ValueResult> {
    return window.electronAPI.getValue(vaultId, chain, tokenId, currency)
  }

  async getTotalValue(vaultId: string, currency?: FiatCurrency): Promise<ValueResult> {
    return window.electronAPI.getTotalValue(vaultId, currency)
  }

  async refreshPortfolioPrices(vaultId: string): Promise<void> {
    return window.electronAPI.refreshPortfolioPrices(vaultId)
  }

  // ===== Swap =====
  async getSupportedSwapChains(_vaultId: string): Promise<string[]> {
    return window.electronAPI.getSupportedSwapChains()
  }

  async isSwapSupported(_vaultId: string, fromChain: string, toChain: string): Promise<boolean> {
    return window.electronAPI.isSwapSupported(fromChain, toChain)
  }

  async getSwapQuote(vaultId: string, params: GetSwapQuoteParams): Promise<SwapQuoteResult> {
    return window.electronAPI.getSwapQuote(vaultId, params)
  }

  async prepareSwapTx(vaultId: string, params: PrepareSwapParams): Promise<SwapResult> {
    return window.electronAPI.prepareSwapTx(vaultId, params)
  }

  // ===== Transactions =====
  async prepareSendTx(vaultId: string, params: SendTxParams): Promise<unknown> {
    return window.electronAPI.prepareSendTx(vaultId, {
      coin: params.coin,
      receiver: params.receiver,
      amount: String(params.amount),
      memo: params.memo,
    })
  }

  async getMaxSendAmount(
    vaultId: string,
    params: { coin: CoinInfo; receiver: string; memo?: string }
  ): Promise<MaxSendAmountResult> {
    return window.electronAPI.getMaxSendAmount(vaultId, params)
  }

  async extractMessageHashes(vaultId: string, keysignPayload: unknown): Promise<string[]> {
    return window.electronAPI.extractMessageHashes(vaultId, keysignPayload)
  }

  async sign(vaultId: string, payload: unknown): Promise<unknown> {
    return window.electronAPI.sign(vaultId, payload)
  }

  async broadcastTx(vaultId: string, params: BroadcastParams): Promise<string> {
    return window.electronAPI.broadcastTx(vaultId, {
      chain: params.chain,
      keysignPayload: params.keysignPayload,
      signature: params.signature,
    })
  }

  async getTxStatus(vaultId: string, chain: string, txHash: string): Promise<TxStatusResult> {
    return window.electronAPI.getTxStatus(vaultId, chain, txHash)
  }

  // ===== Export/Misc =====
  async exportVault(vaultId: string, options?: ExportOptions): Promise<string> {
    return window.electronAPI.exportVault(vaultId, options)
  }

  async renameVault(vaultId: string, newName: string): Promise<void> {
    return window.electronAPI.renameVault(vaultId, newName)
  }

  async getTxExplorerUrl(chain: string, txHash: string): Promise<string> {
    return window.electronAPI.getTxExplorerUrl(chain, txHash)
  }

  async getChainList(): Promise<string[]> {
    return window.electronAPI.getChainList()
  }

  // ===== Discount Tier =====
  async getDiscountTier(vaultId: string): Promise<DiscountTier> {
    return window.electronAPI.getDiscountTier(vaultId)
  }

  async updateDiscountTier(vaultId: string): Promise<DiscountTier> {
    return window.electronAPI.updateDiscountTier(vaultId)
  }

  // ===== Active Vault =====
  async getActiveVault(): Promise<VaultInfo | null> {
    return window.electronAPI.getActiveVault()
  }

  async setActiveVault(vaultId: string): Promise<void> {
    await window.electronAPI.setActiveVault(vaultId)
    const vault = await this.getActiveVault()
    this.emitVaultChanged(vault)
  }
}
