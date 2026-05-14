import type { DeviceJoinedData, ProgressStep, VaultInfo } from '../types'

/**
 * Shared callback-set plumbing for browser/electron {@link ISDKAdapter} implementations.
 * Keeps subscription and emit behavior aligned across environments.
 */
export class SDKAdapterEventSubscriptionBase {
  protected readonly progressCallbacks = new Set<(step: ProgressStep) => void>()
  protected readonly qrCallbacks = new Set<(qrPayload: string) => void>()
  protected readonly deviceCallbacks = new Set<(data: DeviceJoinedData) => void>()
  protected readonly signingProgressCallbacks = new Set<(step: ProgressStep) => void>()
  protected readonly vaultChangedCallbacks = new Set<(vault: VaultInfo | null) => void>()
  protected readonly balanceUpdatedCallbacks = new Set<(data: { chain: string; tokenId?: string }) => void>()
  protected readonly chainChangedCallbacks = new Set<(data: { chain: string; action: 'added' | 'removed' }) => void>()
  protected readonly txBroadcastCallbacks = new Set<(data: { chain: string; txHash: string }) => void>()
  protected readonly txConfirmedCallbacks = new Set<(data: { chain: string; txHash: string }) => void>()
  protected readonly txFailedCallbacks = new Set<(data: { chain: string; txHash: string }) => void>()
  protected readonly errorCallbacks = new Set<(error: Error) => void>()

  /** Map SDK progress fields to UI {@link ProgressStep} (`step` becomes `phase`). */
  protected mapSdkProgressToStep(sdk: { message: string; progress: number; step: string }): ProgressStep {
    return {
      message: sdk.message,
      progress: sdk.progress,
      phase: sdk.step,
    }
  }

  protected emitProgress(step: ProgressStep): void {
    this.progressCallbacks.forEach(cb => cb(step))
  }

  protected emitProgressFromSdkStep(step: { message: string; progress: number; step: string }): void {
    this.emitProgress(this.mapSdkProgressToStep(step))
  }

  protected emitQrCodeReady(qrPayload: string): void {
    this.qrCallbacks.forEach(cb => cb(qrPayload))
  }

  protected emitDeviceJoined(data: DeviceJoinedData): void {
    this.deviceCallbacks.forEach(cb => cb(data))
  }

  protected emitSigningProgress(step: ProgressStep): void {
    this.signingProgressCallbacks.forEach(cb => cb(step))
  }

  protected emitVaultChanged(vault: VaultInfo | null): void {
    this.vaultChangedCallbacks.forEach(cb => cb(vault))
  }

  protected emitBalanceUpdated(data: { chain: string; tokenId?: string }): void {
    this.balanceUpdatedCallbacks.forEach(cb => cb(data))
  }

  protected emitChainChanged(data: { chain: string; action: 'added' | 'removed' }): void {
    this.chainChangedCallbacks.forEach(cb => cb(data))
  }

  protected emitTransactionBroadcast(data: { chain: string; txHash: string }): void {
    this.txBroadcastCallbacks.forEach(cb => cb(data))
  }

  protected emitTransactionConfirmed(data: { chain: string; txHash: string }): void {
    this.txConfirmedCallbacks.forEach(cb => cb(data))
  }

  protected emitTransactionFailed(data: { chain: string; txHash: string }): void {
    this.txFailedCallbacks.forEach(cb => cb(data))
  }

  protected emitError(error: Error): void {
    this.errorCallbacks.forEach(cb => cb(error))
  }

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

  onTransactionConfirmed(callback: (data: { chain: string; txHash: string }) => void): () => void {
    this.txConfirmedCallbacks.add(callback)
    return () => this.txConfirmedCallbacks.delete(callback)
  }

  onTransactionFailed(callback: (data: { chain: string; txHash: string }) => void): () => void {
    this.txFailedCallbacks.add(callback)
    return () => this.txFailedCallbacks.delete(callback)
  }

  onError(callback: (error: Error) => void): () => void {
    this.errorCallbacks.add(callback)
    return () => this.errorCallbacks.delete(callback)
  }
}
