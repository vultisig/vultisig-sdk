import { fromBinary } from '@bufbuild/protobuf'
import { getKeygenThreshold } from '@core/mpc/getKeygenThreshold'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'

import type { SdkContext, VaultContext } from '../context/SdkContext'
import { RelaySigningService } from '../services/RelaySigningService'
import { SecureVaultCreationService, type SecureVaultCreationStep } from '../services/SecureVaultCreationService'
import type {
  Signature,
  SignBytesOptions,
  SigningMode,
  SigningPayload,
  SigningStep,
  VaultCreationStep,
  VaultData,
} from '../types'
import { normalizeToHex } from '../utils/bytes'
import { createVaultBackup } from '../utils/export'
import { VaultBase } from './VaultBase'
import { VaultError, VaultErrorCode } from './VaultError'

/**
 * SecureVault - Multi-device MPC vault
 *
 * Secure vaults use multi-device threshold signature scheme with 2/3 majority threshold.
 * They can be encrypted or unencrypted.
 *
 * Key characteristics:
 * - Can be encrypted or unencrypted (isEncrypted varies)
 * - 2/3 majority threshold (ceil(n*2/3)) for n signers
 * - Currently supports 'relay' signing mode
 * - Does NOT support 'fast' signing mode
 *
 * @todo Implement 'local' signing mode for direct device-to-device MPC
 *       without relay server (requires LocalSigningService)
 */
export class SecureVault extends VaultBase {
  private readonly context: VaultContext

  /**
   * Private constructor - use SecureVault.create() or SecureVault.fromStorage() instead.
   * @internal
   */
  private constructor(
    vaultId: string,
    name: string,
    vultFileContent: string,
    context: VaultContext,
    parsedVaultData?: CoreVault
  ) {
    super(vaultId, name, vultFileContent, context, parsedVaultData)
    this.context = context
  }

  /**
   * Secure vaults currently support relay signing mode.
   * Local signing mode is planned for future implementation.
   */
  get availableSigningModes(): SigningMode[] {
    return ['relay']
  }

  /**
   * Secure vaults use 2/3 majority threshold for n signers
   * Example: 2 signers → threshold of 2, 3 signers → threshold of 2
   */
  get threshold(): number {
    return getKeygenThreshold(this.coreVault.signers.length)
  }

  /**
   * Sign a transaction using relay signing mode
   *
   * This method coordinates multi-device MPC signing via the relay server.
   * It will display a QR code for mobile device pairing and emit progress events.
   *
   * @param payload - Transaction payload to sign (must include messageHashes)
   * @param options - Signing options including callbacks for QR and device joining
   * @returns Signature from multi-device coordination
   *
   * @example
   * ```typescript
   * vault.on('qrCodeReady', ({ qrPayload }) => displayQR(qrPayload))
   * vault.on('deviceJoined', ({ deviceId, totalJoined, required }) => {
   *   console.log(`${totalJoined}/${required} devices ready`)
   * })
   * const signature = await vault.sign(payload)
   * ```
   */
  async sign(
    payload: SigningPayload,
    options: {
      signal?: AbortSignal
      onQRCodeReady?: (qrPayload: string) => void
      onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
    } = {}
  ): Promise<Signature> {
    // Ensure keyShares are loaded (will decrypt if encrypted)
    await this.ensureKeySharesLoaded()

    // Get WalletCore for chain utilities
    const walletCore = await this.wasmProvider.getWalletCore()

    // Create relay signing service
    const relaySigningService = new RelaySigningService()

    // Sign using relay service with event emission
    const signature = await relaySigningService.signWithRelay(this.coreVault, payload, walletCore, {
      signal: options.signal,
      onProgress: (step: SigningStep) => {
        this.emit('signingProgress', { step })
      },
      onQRCodeReady: qrPayload => {
        this.emit('qrCodeReady', {
          qrPayload,
          action: 'keysign',
          sessionId: '',
        })
        if (options.onQRCodeReady) {
          options.onQRCodeReady(qrPayload)
        }
      },
      onDeviceJoined: (deviceId, totalJoined, required) => {
        this.emit('deviceJoined', { deviceId, totalJoined, required })
        if (options.onDeviceJoined) {
          options.onDeviceJoined(deviceId, totalJoined, required)
        }
      },
    })

    // Emit completion event
    this.emit('transactionSigned', { signature, payload })

    return signature
  }

  /**
   * Sign arbitrary pre-hashed bytes using relay signing mode
   *
   * This method coordinates multi-device MPC signing for raw bytes via the relay server.
   * It will display a QR code for mobile device pairing and emit progress events.
   *
   * @param options - Sign bytes options (data and chain)
   * @param signingOptions - Signing options including callbacks for QR and device joining
   * @returns Signature result
   *
   * @example
   * ```typescript
   * const messageHash = '0x...' // Pre-hashed data
   * const signature = await vault.signBytes(
   *   { data: messageHash, chain: 'Ethereum' },
   *   { onQRCodeReady: (qr) => displayQR(qr) }
   * )
   * ```
   */
  async signBytes(
    options: SignBytesOptions,
    signingOptions: {
      signal?: AbortSignal
      onQRCodeReady?: (qrPayload: string) => void
      onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
    } = {}
  ): Promise<Signature> {
    try {
      // Normalize input to hex string
      const messageHash = normalizeToHex(options.data)

      // Ensure keyShares are loaded (will decrypt if encrypted)
      await this.ensureKeySharesLoaded()

      // Get WalletCore for chain utilities
      const walletCore = await this.wasmProvider.getWalletCore()

      // Create relay signing service
      const relaySigningService = new RelaySigningService()

      // Sign using relay service with event emission
      const signature = await relaySigningService.signBytesWithRelay(
        this.coreVault,
        {
          messageHashes: [messageHash],
          chain: options.chain,
        },
        walletCore,
        {
          signal: signingOptions.signal,
          onProgress: (step: SigningStep) => {
            this.emit('signingProgress', { step })
          },
          onQRCodeReady: qrPayload => {
            this.emit('qrCodeReady', {
              qrPayload,
              action: 'keysign',
              sessionId: '',
            })
            if (signingOptions.onQRCodeReady) {
              signingOptions.onQRCodeReady(qrPayload)
            }
          },
          onDeviceJoined: (deviceId, totalJoined, required) => {
            this.emit('deviceJoined', { deviceId, totalJoined, required })
            if (signingOptions.onDeviceJoined) {
              signingOptions.onDeviceJoined(deviceId, totalJoined, required)
            }
          },
        }
      )

      // Emit signing complete event
      this.emit('transactionSigned', {
        signature,
        payload: { chain: options.chain, transaction: null, messageHashes: [messageHash] },
      })

      return signature
    } catch (error) {
      this.emit('error', error as Error)

      if (error instanceof VaultError) {
        throw error
      }

      throw new VaultError(
        VaultErrorCode.SigningFailed,
        `signBytes failed: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Ensure keyShares are loaded into memory
   *
   * Secure vaults can be encrypted or unencrypted:
   * - If encrypted: Decrypt with password
   * - If unencrypted: Load directly
   */
  protected async ensureKeySharesLoaded(): Promise<void> {
    // Check if keyShares are already loaded
    if (
      this.coreVault.keyShares.ecdsa &&
      this.coreVault.keyShares.ecdsa.length > 0 &&
      this.coreVault.keyShares.eddsa &&
      this.coreVault.keyShares.eddsa.length > 0
    ) {
      return // Already loaded
    }

    // Check if vault file content is available
    if (!this.vaultData.vultFileContent || this.vaultData.vultFileContent.trim().length === 0) {
      throw new VaultError(VaultErrorCode.InvalidVault, 'Vault file content is empty. Cannot load keyShares.')
    }

    // Parse vault file to get keyShares
    const container = vaultContainerFromString(this.vaultData.vultFileContent.trim())

    let vaultBase64: string

    // Check encryption status at call site
    if (this.vaultData.isEncrypted) {
      // Get password and decrypt
      const password = await this.resolvePassword()

      const encryptedData = fromBase64(container.vault)
      const decryptedBuffer = await decryptWithAesGcm({
        key: password,
        value: encryptedData,
      })

      vaultBase64 = Buffer.from(decryptedBuffer).toString('base64')
    } else {
      // No decryption needed
      vaultBase64 = container.vault
    }

    // Parse inner Vault protobuf
    const vaultBinary = fromBase64(vaultBase64)
    const vaultProtobuf = fromBinary(VaultSchema, vaultBinary)
    const parsedVault = fromCommVault(vaultProtobuf)

    // Update CoreVault with keyShares
    this.coreVault.keyShares = parsedVault.keyShares

    // Emit unlocked event (even for unencrypted vaults, keyShares are now loaded)
    this.emit('unlocked', { vaultId: this.id })
  }

  /**
   * Create a new secure vault (multi-device MPC).
   *
   * This method orchestrates the multi-device keygen ceremony:
   * 1. Generates a QR code for mobile app pairing
   * 2. Waits for all devices to join
   * 3. Runs DKLS (ECDSA) + Schnorr (EdDSA) keygen
   * 4. Returns the created vault
   *
   * @param context - SDK context with all dependencies
   * @param options - Vault creation options
   * @returns Promise resolving to vault instance, ID, and session ID
   *
   * @example
   * ```typescript
   * const { vault, vaultId, sessionId } = await SecureVault.create(
   *   sdkContext,
   *   {
   *     name: 'My Secure Wallet',
   *     devices: 3,
   *     onProgress: (step) => console.log(step.message),
   *     onQRCodeReady: (qrPayload) => displayQR(qrPayload),
   *     onDeviceJoined: (id, joined, required) => console.log(`${joined}/${required}`)
   *   }
   * )
   * ```
   */
  static async create(
    context: SdkContext,
    options: {
      /** Vault name */
      name: string
      /** Optional password for vault encryption (secure vaults can be unencrypted) */
      password?: string
      /** Total number of devices participating (including this one) */
      devices: number
      /** Signing threshold - defaults to 2/3 majority (ceil(devices*2/3)) */
      threshold?: number
      /** AbortSignal for cancellation */
      signal?: AbortSignal
      /** Progress callback */
      onProgress?: (step: VaultCreationStep) => void
      /** Callback when QR code is ready for display */
      onQRCodeReady?: (qrPayload: string) => void
      /** Callback when a device joins the session */
      onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
    }
  ): Promise<{
    vault: SecureVault
    vaultId: string
    sessionId: string
  }> {
    const reportProgress = (step: VaultCreationStep) => {
      if (options.signal?.aborted) {
        throw new Error('Operation aborted')
      }
      options.onProgress?.(step)
    }

    try {
      // Step 1: Create SecureVaultCreationService (uses default relay URL)
      const creationService = new SecureVaultCreationService()

      // Step 2: Map progress callbacks
      const mapProgress = (step: SecureVaultCreationStep): VaultCreationStep => ({
        step:
          step.step === 'keygen_ecdsa' || step.step === 'keygen_eddsa'
            ? 'keygen'
            : step.step === 'complete'
              ? 'complete'
              : 'keygen',
        progress: step.progress,
        message: step.message,
      })

      // Step 3: Run multi-device keygen ceremony
      const result = await creationService.createVault({
        name: options.name,
        password: options.password,
        devices: options.devices,
        threshold: options.threshold,
        signal: options.signal,
        onProgress: step => reportProgress(mapProgress(step)),
        onQRCodeReady: options.onQRCodeReady,
        onDeviceJoined: options.onDeviceJoined,
      })

      // Step 4: Generate .vult backup file
      reportProgress({
        step: 'complete',
        progress: 92,
        message: 'Creating backup file',
      })

      const vultContent = options.password
        ? await createVaultBackup(result.vault, options.password)
        : await createVaultBackup(result.vault)

      // Step 5: Build VaultContext from SdkContext
      const vaultContext: VaultContext = {
        storage: context.storage,
        config: context.config,
        serverManager: context.serverManager,
        passwordCache: context.passwordCache,
        wasmProvider: context.wasmProvider,
      }

      // Step 6: Instantiate vault
      reportProgress({
        step: 'complete',
        progress: 96,
        message: 'Creating vault instance',
      })

      const vaultInstance = new SecureVault(
        result.vaultId,
        result.vault.name,
        vultContent,
        vaultContext,
        result.vault // Pre-parsed vault data
      )

      // Step 7: Cache password if provided
      if (options.password) {
        context.passwordCache.set(result.vaultId, options.password)
      }

      // Step 8: Complete
      reportProgress({
        step: 'complete',
        progress: 100,
        message: 'Secure vault created successfully',
      })

      return {
        vault: vaultInstance,
        vaultId: result.vaultId,
        sessionId: result.sessionId,
      }
    } catch (error) {
      // Wrap errors with context
      if (error instanceof Error) {
        throw new VaultError(VaultErrorCode.CreateFailed, `Failed to create secure vault: ${error.message}`, error)
      }
      throw error
    }
  }

  /**
   * Create a SecureVault instance from imported .vult file content
   *
   * @param vaultId - Vault ID (ECDSA public key)
   * @param vultContent - The .vult file content
   * @param parsedVault - Pre-parsed CoreVault data
   * @param context - Vault context with dependencies
   * @internal Used by VaultManager.importVault()
   */
  static fromImport(vaultId: string, vultContent: string, parsedVault: CoreVault, context: VaultContext): SecureVault {
    return new SecureVault(vaultId, parsedVault.name, vultContent, context, parsedVault)
  }

  /**
   * Reconstruct a SecureVault instance from stored VaultData
   *
   * @param vaultData - Stored vault data
   * @param context - Vault context with dependencies
   */
  static fromStorage(vaultData: VaultData, context: VaultContext): SecureVault {
    // Validate vault type
    if (vaultData.type !== 'secure') {
      throw new VaultError(VaultErrorCode.InvalidVault, `Cannot create SecureVault from ${vaultData.type} vault data`)
    }

    // Use the constructor with stored vult file content
    const vault = new SecureVault(vaultData.id, vaultData.name, vaultData.vultFileContent || '', context)

    // Override constructor defaults with stored preferences from VaultData
    if (vaultData.chains && vaultData.chains.length > 0) {
      ;(vault as any)._userChains = vaultData.chains.map((c: string) => c as any)
    }
    if (vaultData.currency) {
      ;(vault as any)._currency = vaultData.currency
    }
    if (vaultData.tokens && Object.keys(vaultData.tokens).length > 0) {
      ;(vault as any)._tokens = vaultData.tokens
    }

    // Override vaultData to ensure all stored fields are preserved
    ;(vault as any).vaultData = vaultData

    // CRITICAL: Update coreVault with stored identity fields
    vault.coreVault.publicKeys = vaultData.publicKeys
    vault.coreVault.hexChainCode = vaultData.hexChainCode
    vault.coreVault.signers = [...vaultData.signers]
    vault.coreVault.localPartyId = vaultData.localPartyId
    vault.coreVault.libType = vaultData.libType
    vault.coreVault.createdAt = vaultData.createdAt

    return vault
  }
}
