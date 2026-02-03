import type {
  BalanceResult,
  BroadcastParams,
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
  PrepareSwapParams,
  ProgressStep,
  SeedphraseValidation,
  SendTxParams,
  SwapQuoteResult,
  SwapResult,
  TokenInfo,
  ValueResult,
  VaultInfo,
} from '@vultisig/examples-shared'
import type { Chain, Token, VaultBase, Vultisig } from '@vultisig/sdk'

/**
 * Browser SDK Adapter - wraps direct SDK instance for browser environment
 */
export class BrowserSDKAdapter implements ISDKAdapter {
  private sdk: Vultisig
  private progressCallbacks = new Set<(step: ProgressStep) => void>()
  private qrCallbacks = new Set<(qrPayload: string) => void>()
  private deviceCallbacks = new Set<(data: DeviceJoinedData) => void>()
  private signingProgressCallbacks = new Set<(step: ProgressStep) => void>()
  private vaultChangedCallbacks = new Set<(vault: VaultInfo | null) => void>()
  private balanceUpdatedCallbacks = new Set<(data: { chain: string; tokenId?: string }) => void>()
  private chainChangedCallbacks = new Set<(data: { chain: string; action: 'added' | 'removed' }) => void>()
  private txBroadcastCallbacks = new Set<(data: { chain: string; txHash: string }) => void>()
  private errorCallbacks = new Set<(error: Error) => void>()
  private activeVaultId: string | null = null
  private vaultCache = new Map<string, VaultBase>()

  constructor(sdk: Vultisig) {
    this.sdk = sdk

    // Subscribe to SDK-level events
    this.sdk.on('vaultCreationProgress', ({ step }) => {
      const progressStep: ProgressStep = {
        message: step.message,
        progress: step.progress,
        phase: step.step, // Map SDK's 'step' to our 'phase'
      }
      this.progressCallbacks.forEach(cb => cb(progressStep))
    })
  }

  // Helper to get vault instance
  private async getVault(vaultId: string): Promise<VaultBase> {
    let vault = this.vaultCache.get(vaultId)
    if (!vault) {
      const foundVault = await this.sdk.getVaultById(vaultId)
      if (!foundVault) {
        throw new Error(`Vault not found: ${vaultId}`)
      }
      vault = foundVault
      this.vaultCache.set(vaultId, vault)
      this.subscribeToVaultEvents(vault)
    }
    return vault
  }

  // Subscribe to vault-level events
  private subscribeToVaultEvents(vault: VaultBase): void {
    vault.on('signingProgress', ({ step }) => {
      const progressStep: ProgressStep = {
        message: step.message,
        progress: step.progress,
        phase: step.step, // Map SDK's 'step' to our 'phase'
      }
      this.signingProgressCallbacks.forEach(cb => cb(progressStep))
    })

    vault.on('qrCodeReady', ({ qrPayload }) => {
      this.qrCallbacks.forEach(cb => cb(qrPayload))
    })

    vault.on('deviceJoined', ({ deviceId, totalJoined, required }) => {
      this.deviceCallbacks.forEach(cb => cb({ deviceId, totalJoined, required }))
    })

    vault.on('balanceUpdated', ({ chain, tokenId }) => {
      this.balanceUpdatedCallbacks.forEach(cb => cb({ chain: chain as string, tokenId }))
    })

    vault.on('chainAdded', ({ chain }) => {
      this.chainChangedCallbacks.forEach(cb => cb({ chain: chain as string, action: 'added' }))
    })

    vault.on('chainRemoved', ({ chain }) => {
      this.chainChangedCallbacks.forEach(cb => cb({ chain: chain as string, action: 'removed' }))
    })

    vault.on('transactionBroadcast', ({ chain, txHash }) => {
      this.txBroadcastCallbacks.forEach(cb => cb({ chain: chain as string, txHash }))
    })

    vault.on('error', error => {
      this.errorCallbacks.forEach(cb => cb(error))
    })
  }

  // Convert VaultBase to VaultInfo
  private vaultToInfo(vault: VaultBase): VaultInfo {
    return {
      id: vault.id,
      name: vault.name,
      type: vault.type as 'fast' | 'secure',
      chains: vault.chains as string[],
      threshold: vault.threshold,
      signerCount: vault.signers.length,
    }
  }

  // Convert Token to TokenInfo
  private tokenToInfo(token: Token): TokenInfo {
    return {
      id: token.id,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      contractAddress: token.contractAddress,
      chainId: token.chainId as string,
    }
  }

  // ===== Vault Management =====
  async listVaults(): Promise<VaultInfo[]> {
    const vaults = await this.sdk.listVaults()
    // Cache vaults and subscribe to events
    vaults.forEach(v => {
      if (!this.vaultCache.has(v.id)) {
        this.vaultCache.set(v.id, v)
        this.subscribeToVaultEvents(v)
      }
    })
    return vaults.map(v => this.vaultToInfo(v))
  }

  async createFastVault(options: CreateFastVaultOptions): Promise<{ vaultId: string }> {
    const vaultId = await this.sdk.createFastVault({
      name: options.name,
      password: options.password,
      email: options.email,
      onProgress: options.onProgress
        ? step => {
            options.onProgress!({
              message: step.message,
              progress: step.progress,
              phase: step.step, // Map SDK's 'step' to our 'phase'
            })
          }
        : undefined,
    })
    return { vaultId }
  }

  async verifyVault(vaultId: string, code: string): Promise<VaultInfo> {
    const vault = await this.sdk.verifyVault(vaultId, code)
    this.vaultCache.set(vault.id, vault)
    this.subscribeToVaultEvents(vault)
    return this.vaultToInfo(vault)
  }

  async resendVaultVerification(options: { vaultId: string; email: string; password: string }): Promise<void> {
    await this.sdk.resendVaultVerification(options)
  }

  async createSecureVault(options: CreateSecureVaultOptions): Promise<CreateSecureVaultResult> {
    const result = await this.sdk.createSecureVault({
      name: options.name,
      password: options.password || '',
      devices: options.devices,
      threshold: options.threshold,
      onProgress: options.onProgress
        ? step => {
            options.onProgress!({
              message: step.message,
              progress: step.progress,
              phase: step.step, // Map SDK's 'step' to our 'phase'
            })
          }
        : undefined,
      onQRCodeReady: options.onQRCodeReady,
      onDeviceJoined: options.onDeviceJoined,
    })
    this.vaultCache.set(result.vault.id, result.vault)
    this.subscribeToVaultEvents(result.vault)
    return {
      vault: this.vaultToInfo(result.vault),
      sessionId: result.sessionId,
    }
  }

  async importVault(content: string, password?: string): Promise<VaultInfo> {
    const vault = await this.sdk.importVault(content, password)
    this.vaultCache.set(vault.id, vault)
    this.subscribeToVaultEvents(vault)
    return this.vaultToInfo(vault)
  }

  async isVaultEncrypted(content: string): Promise<boolean> {
    return this.sdk.isVaultEncrypted(content)
  }

  async deleteVault(vaultId: string): Promise<void> {
    const vault = await this.getVault(vaultId)
    await this.sdk.deleteVault(vault)
    this.vaultCache.delete(vaultId)
  }

  // ===== Seedphrase Vault Creation =====
  async validateSeedphrase(mnemonic: string): Promise<SeedphraseValidation> {
    return this.sdk.validateSeedphrase(mnemonic)
  }

  async createFastVaultFromSeedphrase(options: CreateFastVaultFromSeedphraseOptions): Promise<{ vaultId: string }> {
    const vaultId = await this.sdk.createFastVaultFromSeedphrase({
      mnemonic: options.mnemonic,
      name: options.name,
      password: options.password,
      email: options.email,
      discoverChains: options.discoverChains,
      chains: options.chains as Chain[],
      onProgress: step => {
        const progressStep: ProgressStep = {
          message: step.message,
          progress: step.progress,
          phase: step.step,
        }
        // Emit to global callbacks (for event log)
        this.progressCallbacks.forEach(cb => cb(progressStep))
        // Emit to component callback (for UI state)
        options.onProgress?.(progressStep)
      },
      onChainDiscovery: options.onChainDiscovery,
    })
    return { vaultId }
  }

  async createSecureVaultFromSeedphrase(
    options: CreateSecureVaultFromSeedphraseOptions
  ): Promise<CreateSecureVaultResult> {
    const result = await this.sdk.createSecureVaultFromSeedphrase({
      mnemonic: options.mnemonic,
      name: options.name,
      password: options.password,
      devices: options.devices,
      threshold: options.threshold,
      discoverChains: options.discoverChains,
      chains: options.chains as Chain[],
      onProgress: step => {
        const progressStep: ProgressStep = {
          message: step.message,
          progress: step.progress,
          phase: step.step,
        }
        // Emit to global callbacks (for event log)
        this.progressCallbacks.forEach(cb => cb(progressStep))
        // Emit to component callback (for UI state)
        options.onProgress?.(progressStep)
      },
      onQRCodeReady: qrPayload => {
        // Emit to global callbacks (for event log)
        this.qrCallbacks.forEach(cb => cb(qrPayload))
        // Emit to component callback (for UI state)
        options.onQRCodeReady?.(qrPayload)
      },
      onDeviceJoined: (deviceId, totalJoined, required) => {
        // Emit to global callbacks (for event log)
        this.deviceCallbacks.forEach(cb => cb({ deviceId, totalJoined, required }))
        // Emit to component callback (for UI state)
        options.onDeviceJoined?.(deviceId, totalJoined, required)
      },
      onChainDiscovery: options.onChainDiscovery,
    })
    this.vaultCache.set(result.vault.id, result.vault)
    this.subscribeToVaultEvents(result.vault)
    return {
      vault: this.vaultToInfo(result.vault),
      sessionId: result.sessionId,
    }
  }

  async joinSecureVault(qrPayload: string, options: JoinSecureVaultOptions): Promise<JoinSecureVaultResult> {
    const result = await this.sdk.joinSecureVault(qrPayload, {
      mnemonic: options.mnemonic,
      password: options.password,
      devices: options.devices,
      onProgress: options.onProgress
        ? step => {
            const progressStep: ProgressStep = {
              message: step.message,
              progress: step.progress,
              phase: step.step,
            }
            // Emit to global callbacks (for event log)
            this.progressCallbacks.forEach(cb => cb(progressStep))
            // Emit to component callback (for UI state)
            options.onProgress?.(progressStep)
          }
        : undefined,
      onDeviceJoined: options.onDeviceJoined
        ? (deviceId, totalJoined, required) => {
            // Emit to global callbacks (for event log)
            this.deviceCallbacks.forEach(cb => cb({ deviceId, totalJoined, required }))
            // Emit to component callback (for UI state)
            options.onDeviceJoined?.(deviceId, totalJoined, required)
          }
        : undefined,
    })
    this.vaultCache.set(result.vault.id, result.vault)
    this.subscribeToVaultEvents(result.vault)
    return {
      vault: this.vaultToInfo(result.vault),
      vaultId: result.vaultId,
    }
  }

  // ===== Vault Operations =====
  async getAddress(vaultId: string, chain: string): Promise<string> {
    const vault = await this.getVault(vaultId)
    return vault.address(chain as Chain)
  }

  async getAllAddresses(vaultId: string): Promise<Record<string, string>> {
    const vault = await this.getVault(vaultId)
    const addresses: Record<string, string> = {}
    for (const chain of vault.chains) {
      addresses[chain] = await vault.address(chain as Chain)
    }
    return addresses
  }

  async addChain(vaultId: string, chain: string): Promise<void> {
    const vault = await this.getVault(vaultId)
    await vault.addChain(chain as Chain)
  }

  async removeChain(vaultId: string, chain: string): Promise<void> {
    const vault = await this.getVault(vaultId)
    await vault.removeChain(chain as Chain)
  }

  // ===== Tokens =====
  async getTokens(vaultId: string, chain: string): Promise<TokenInfo[]> {
    const vault = await this.getVault(vaultId)
    const tokens = vault.getTokens(chain as Chain)
    return tokens.map(t => this.tokenToInfo(t))
  }

  async addToken(vaultId: string, chain: string, token: TokenInfo): Promise<void> {
    const vault = await this.getVault(vaultId)
    const sdkToken: Token = {
      id: token.id,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      contractAddress: token.contractAddress || token.id,
      chainId: chain as Chain,
    }
    await vault.addToken(chain as Chain, sdkToken)
  }

  async removeToken(vaultId: string, chain: string, tokenId: string): Promise<void> {
    const vault = await this.getVault(vaultId)
    await vault.removeToken(chain as Chain, tokenId)
  }

  // ===== Balance & Portfolio =====
  async getBalance(vaultId: string, chain: string, tokenId?: string): Promise<BalanceResult> {
    const vault = await this.getVault(vaultId)
    const balance = await vault.balance(chain as Chain, tokenId)
    return {
      amount: balance.amount,
      decimals: balance.decimals,
      symbol: balance.symbol,
      value: balance.fiatValue,
    }
  }

  async setCurrency(vaultId: string, currency: FiatCurrency): Promise<void> {
    const vault = await this.getVault(vaultId)
    vault.setCurrency(currency)
  }

  async getValue(vaultId: string, chain: string, tokenId?: string, currency?: FiatCurrency): Promise<ValueResult> {
    const vault = await this.getVault(vaultId)
    if (currency) vault.setCurrency(currency)
    const value = await vault.getValue(chain as Chain, tokenId, currency)
    return {
      amount: value.amount,
      currency: (currency || value.currency || 'usd') as FiatCurrency,
    }
  }

  async getTotalValue(vaultId: string, currency?: FiatCurrency): Promise<ValueResult> {
    const vault = await this.getVault(vaultId)
    if (currency) vault.setCurrency(currency)
    const total = await vault.getTotalValue(currency)
    return {
      amount: total.amount,
      currency: (currency || total.currency || 'usd') as FiatCurrency,
    }
  }

  // ===== Swap =====
  async getSupportedSwapChains(vaultId: string): Promise<string[]> {
    const vault = await this.getVault(vaultId)
    return vault.getSupportedSwapChains() as string[]
  }

  async isSwapSupported(vaultId: string, fromChain: string, toChain: string): Promise<boolean> {
    const vault = await this.getVault(vaultId)
    return vault.isSwapSupported(fromChain as Chain, toChain as Chain)
  }

  async getSwapQuote(vaultId: string, params: GetSwapQuoteParams): Promise<SwapQuoteResult> {
    const vault = await this.getVault(vaultId)
    const quote = await vault.getSwapQuote({
      fromCoin: {
        chain: params.fromCoin.chain as Chain,
        address: params.fromCoin.address,
        decimals: params.fromCoin.decimals,
        ticker: params.fromCoin.ticker,
        id: params.fromCoin.id,
      },
      toCoin: {
        chain: params.toCoin.chain as Chain,
        address: params.toCoin.address,
        decimals: params.toCoin.decimals,
        ticker: params.toCoin.ticker,
        id: params.toCoin.id,
      },
      amount: params.amount,
      fiatCurrency: params.fiatCurrency,
    })
    // Map SDK quote to shared type
    return {
      estimatedOutput: quote.estimatedOutput.toString(),
      estimatedOutputFiat: quote.estimatedOutputFiat,
      fees: {
        total: quote.fees.total.toString(),
        network: quote.fees.network?.toString(),
      },
      feesFiat: quote.feesFiat
        ? {
            total: quote.feesFiat.total,
            network: quote.feesFiat.network,
          }
        : undefined,
      provider: quote.provider,
    }
  }

  async prepareSwapTx(vaultId: string, params: PrepareSwapParams): Promise<SwapResult> {
    const vault = await this.getVault(vaultId)
    // Convert shared types to SDK types
    const sdkQuote = {
      ...params.swapQuote,
      estimatedOutput: BigInt(params.swapQuote.estimatedOutput),
      fees: {
        total: BigInt(params.swapQuote.fees.total),
        network: params.swapQuote.fees.network ? BigInt(params.swapQuote.fees.network) : undefined,
        protocol: params.swapQuote.fees.protocol ? BigInt(params.swapQuote.fees.protocol) : undefined,
      },
    }
    const result = await vault.prepareSwapTx({
      fromCoin: {
        chain: params.fromCoin.chain as Chain,
        address: params.fromCoin.address,
        decimals: params.fromCoin.decimals,
        ticker: params.fromCoin.ticker,
        id: params.fromCoin.id,
      },
      toCoin: {
        chain: params.toCoin.chain as Chain,
        address: params.toCoin.address,
        decimals: params.toCoin.decimals,
        ticker: params.toCoin.ticker,
        id: params.toCoin.id,
      },
      amount: params.amount,
      swapQuote: sdkQuote as any,
      autoApprove: params.autoApprove,
    })
    return result as SwapResult
  }

  // ===== Transactions =====
  async prepareSendTx(vaultId: string, params: SendTxParams): Promise<unknown> {
    const vault = await this.getVault(vaultId)
    return vault.prepareSendTx({
      coin: {
        chain: params.coin.chain as Chain,
        address: params.coin.address,
        decimals: params.coin.decimals,
        ticker: params.coin.ticker,
        id: params.coin.id,
      },
      receiver: params.receiver,
      amount: typeof params.amount === 'string' ? BigInt(params.amount) : params.amount,
      memo: params.memo,
    })
  }

  async extractMessageHashes(vaultId: string, keysignPayload: unknown): Promise<string[]> {
    const vault = await this.getVault(vaultId)
    return vault.extractMessageHashes(keysignPayload as any)
  }

  async sign(vaultId: string, payload: unknown): Promise<unknown> {
    const vault = await this.getVault(vaultId)
    return vault.sign(payload as any)
  }

  async broadcastTx(vaultId: string, params: BroadcastParams): Promise<string> {
    const vault = await this.getVault(vaultId)
    return vault.broadcastTx({
      chain: params.chain as Chain,
      keysignPayload: params.keysignPayload as any,
      signature: params.signature as any,
    })
  }

  // ===== Export/Misc =====
  async exportVault(vaultId: string, options?: ExportOptions): Promise<string> {
    const vault = await this.getVault(vaultId)
    const result = await vault.export(options?.password)
    return result.data
  }

  async renameVault(vaultId: string, newName: string): Promise<void> {
    const vault = await this.getVault(vaultId)
    await vault.rename(newName)
  }

  async getTxExplorerUrl(chain: string, txHash: string): Promise<string> {
    // Use static method from Vultisig class
    const { Vultisig } = await import('@vultisig/sdk')
    return Vultisig.getTxExplorerUrl(chain as Chain, txHash)
  }

  async getChainList(): Promise<string[]> {
    const { SUPPORTED_CHAINS } = await import('@vultisig/sdk')
    return SUPPORTED_CHAINS as string[]
  }

  // ===== Discount Tier =====
  async getDiscountTier(vaultId: string): Promise<DiscountTier> {
    const vault = await this.getVault(vaultId)
    const tier = await vault.getDiscountTier()
    return tier as DiscountTier
  }

  async updateDiscountTier(vaultId: string): Promise<DiscountTier> {
    const vault = await this.getVault(vaultId)
    const tier = await vault.updateDiscountTier()
    return tier as DiscountTier
  }

  // ===== Active Vault =====
  async getActiveVault(): Promise<VaultInfo | null> {
    if (!this.activeVaultId) return null
    try {
      const vault = await this.getVault(this.activeVaultId)
      return this.vaultToInfo(vault)
    } catch {
      return null
    }
  }

  async setActiveVault(vaultId: string): Promise<void> {
    this.activeVaultId = vaultId
    const vault = await this.getVault(vaultId)
    await this.sdk.setActiveVault(vault)
    this.vaultChangedCallbacks.forEach(cb => cb(this.vaultToInfo(vault)))
  }

  // ===== Events =====
  onProgress(callback: (step: ProgressStep) => void): () => void {
    this.progressCallbacks.add(callback)
    return () => this.progressCallbacks.delete(callback)
  }

  onQrCodeReady(callback: (qrPayload: string) => void): () => void {
    this.qrCallbacks.add(callback)
    return () => this.qrCallbacks.delete(callback)
  }

  onDeviceJoined(callback: (data: DeviceJoinedData) => void): () => void {
    this.deviceCallbacks.add(callback)
    return () => this.deviceCallbacks.delete(callback)
  }

  onSigningProgress(callback: (step: ProgressStep) => void): () => void {
    this.signingProgressCallbacks.add(callback)
    return () => this.signingProgressCallbacks.delete(callback)
  }

  onVaultChanged(callback: (vault: VaultInfo | null) => void): () => void {
    this.vaultChangedCallbacks.add(callback)
    return () => this.vaultChangedCallbacks.delete(callback)
  }

  onBalanceUpdated(callback: (data: { chain: string; tokenId?: string }) => void): () => void {
    this.balanceUpdatedCallbacks.add(callback)
    return () => this.balanceUpdatedCallbacks.delete(callback)
  }

  onChainChanged(callback: (data: { chain: string; action: 'added' | 'removed' }) => void): () => void {
    this.chainChangedCallbacks.add(callback)
    return () => this.chainChangedCallbacks.delete(callback)
  }

  onTransactionBroadcast(callback: (data: { chain: string; txHash: string }) => void): () => void {
    this.txBroadcastCallbacks.add(callback)
    return () => this.txBroadcastCallbacks.delete(callback)
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.add(callback)
    return () => this.errorCallbacks.delete(callback)
  }
}
