import { fromBinary } from '@bufbuild/protobuf'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'

import type { SdkContext, VaultContext } from '../context/SdkContext'
import { FastSigningService } from '../services/FastSigningService'
import type { Signature, SigningMode, SigningPayload, VaultCreationStep, VaultData } from '../types'
import { createVaultBackup } from '../utils/export'
import { VaultBase } from './VaultBase'
import { VaultError, VaultErrorCode } from './VaultError'

/**
 * FastVault - 2-of-2 MPC with VultiServer
 *
 * Fast vaults provide quick signing using 2-of-2 threshold signature scheme
 * with the VultiServer. They are always encrypted and require a password.
 *
 * Key characteristics:
 * - Always encrypted (isEncrypted = true)
 * - 2-of-2 threshold (device + server)
 * - Only supports 'fast' signing mode
 * - Requires FastSigningService
 */
export class FastVault extends VaultBase {
  private readonly fastSigningService: FastSigningService
  private readonly context: VaultContext

  /**
   * Private constructor - use FastVault.create() or FastVault.fromStorage() instead.
   * @internal
   */
  private constructor(
    vaultId: string,
    name: string,
    vultFileContent: string,
    fastSigningService: FastSigningService,
    context: VaultContext,
    parsedVaultData?: CoreVault
  ) {
    super(vaultId, name, vultFileContent, context, parsedVaultData)

    this.fastSigningService = fastSigningService
    this.context = context
  }

  /**
   * Fast vaults only support 'fast' signing mode
   */
  get availableSigningModes(): SigningMode[] {
    return ['fast']
  }

  /**
   * Fast vaults always use 2-of-2 threshold (device + server)
   */
  get threshold(): number {
    return 2
  }

  /**
   * Sign a transaction using fast signing (2-of-2 MPC with VultiServer)
   *
   * Mode parameter is ignored - fast vaults always use 'fast' mode.
   *
   * @param mode - Signing mode (must be 'fast', others will throw)
   * @param payload - Transaction payload to sign
   * @returns Signature from server coordination
   */
  async sign(payload: SigningPayload): Promise<Signature> {
    try {
      // Ensure keyShares are loaded from vault file (lazy loading)
      await this.ensureKeySharesLoaded()

      // Fast vaults are always encrypted - resolve password
      // resolvePassword() will throw if password not available
      const password = await this.resolvePassword()

      // Sign with server coordination
      const signature = await this.fastSigningService.signWithServer(this.coreVault, payload, password, step => {
        // Emit progress on THIS vault instance
        this.emit('signingProgress', { step })
      })

      // Emit transaction signed event (serves as completion event)
      this.emit('transactionSigned', { signature, payload })

      return signature
    } catch (error) {
      this.emit('error', error as Error)

      if (error instanceof VaultError) {
        throw error
      }

      throw new VaultError(
        VaultErrorCode.SigningFailed,
        `Fast signing failed: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Ensure keyShares are loaded into memory
   *
   * Fast vaults are ALWAYS encrypted, so this always:
   * 1. Resolves password from cache or callback
   * 2. Decrypts vault file
   * 3. Loads keyShares into coreVault
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

    // Fast vaults are ALWAYS encrypted - no need to check container.isEncrypted
    // Resolve password (will throw if not available)
    const password = await this.resolvePassword()

    // Decrypt vault
    const encryptedData = fromBase64(container.vault)
    const decryptedBuffer = await decryptWithAesGcm({
      key: password,
      value: encryptedData,
    })
    const vaultBase64 = Buffer.from(decryptedBuffer).toString('base64')

    // Parse inner Vault protobuf
    const vaultBinary = fromBase64(vaultBase64)
    const vaultProtobuf = fromBinary(VaultSchema, vaultBinary)
    const parsedVault = fromCommVault(vaultProtobuf)

    // Update CoreVault with keyShares
    this.coreVault.keyShares = parsedVault.keyShares

    // Emit unlocked event
    this.emit('unlocked', { vaultId: this.id })
  }

  /**
   * Create a new fast vault (2-of-2 with VultiServer).
   *
   * @param context - SDK context with all dependencies
   * @param options - Vault creation options
   * @returns Promise resolving to vault instance, ID, and verification status
   *
   * @example
   * ```typescript
   * const { vault, vaultId, verificationRequired } = await FastVault.create(
   *   sdkContext,
   *   {
   *     name: 'My Wallet',
   *     password: 'secure-password',
   *     email: 'user@example.com',
   *     onProgress: (step) => {
   *       console.log(`Step: ${step.step}, Progress: ${step.progress}%`)
   *     }
   *   }
   * )
   * ```
   */
  static async create(
    context: SdkContext,
    options: {
      name: string
      password: string
      email: string
      onProgress?: (step: VaultCreationStep) => void
    }
  ): Promise<{
    vault: FastVault
    vaultId: string
    verificationRequired: true
  }> {
    const reportProgress = options.onProgress || (() => {})

    try {
      // Step 1: Create vault on server with MPC keygen
      reportProgress({
        step: 'keygen',
        progress: 10,
        message: 'Starting key generation',
      })

      const result = await context.serverManager.createFastVault({
        name: options.name,
        email: options.email,
        password: options.password,
        onProgress: update => {
          // Map server progress updates to vault creation progress
          let progress = 10
          if (update.phase === 'ecdsa') {
            progress = 35 // 20-50% range
          } else if (update.phase === 'eddsa') {
            progress = 65 // 50-80% range
          }

          reportProgress({
            step: 'keygen',
            progress: Math.round(progress),
            message: update.message || 'Generating keys...',
          })
        },
      })

      // Step 2: Derive vault ID from public key
      const vaultId = result.vault.publicKeys.ecdsa

      // Step 3: Generate .vult backup file
      reportProgress({
        step: 'complete',
        progress: 85,
        message: 'Creating backup file',
      })

      const vultContent = await createVaultBackup(result.vault, options.password)

      // Step 4: Create FastSigningService
      const fastSigningService = new FastSigningService(context.serverManager, context.wasmProvider)

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
        progress: 90,
        message: 'Creating vault instance',
      })

      const vaultInstance = new FastVault(
        vaultId,
        result.vault.name,
        vultContent,
        fastSigningService,
        vaultContext,
        result.vault // Pre-parsed vault data
      )

      // Step 7: Cache password
      context.passwordCache.set(vaultId, options.password)

      // Step 8: Save to storage
      reportProgress({
        step: 'complete',
        progress: 95,
        message: 'Saving vault',
      })

      await vaultInstance.save()

      // Step 9: Set as active vault
      await context.storage.set('activeVaultId', vaultId)

      // Step 10: Complete
      reportProgress({
        step: 'complete',
        progress: 100,
        message: 'Vault created successfully',
      })

      return {
        vault: vaultInstance,
        vaultId: result.vaultId,
        verificationRequired: true,
      }
    } catch (error) {
      // Wrap errors with context
      if (error instanceof Error) {
        throw new VaultError(VaultErrorCode.CreateFailed, `Failed to create fast vault: ${error.message}`, error)
      }
      throw error
    }
  }

  /**
   * Create a FastVault instance from imported .vult file content
   *
   * @param vaultId - Vault ID (ECDSA public key)
   * @param vultContent - The .vult file content
   * @param parsedVault - Pre-parsed CoreVault data
   * @param fastSigningService - Fast signing service instance
   * @param context - Vault context with dependencies
   * @internal Used by VaultManager.importVault()
   */
  static fromImport(
    vaultId: string,
    vultContent: string,
    parsedVault: CoreVault,
    fastSigningService: FastSigningService,
    context: VaultContext
  ): FastVault {
    return new FastVault(vaultId, parsedVault.name, vultContent, fastSigningService, context, parsedVault)
  }

  /**
   * Reconstruct a FastVault instance from stored VaultData
   *
   * @param vaultData - Stored vault data
   * @param fastSigningService - Fast signing service instance
   * @param context - Vault context with dependencies
   */
  static fromStorage(vaultData: VaultData, fastSigningService: FastSigningService, context: VaultContext): FastVault {
    // Validate vault type
    if (vaultData.type !== 'fast') {
      throw new VaultError(VaultErrorCode.InvalidVault, `Cannot create FastVault from ${vaultData.type} vault data`)
    }

    // Use the constructor with stored vult file content
    const vault = new FastVault(
      vaultData.id,
      vaultData.name,
      vaultData.vultFileContent || '',
      fastSigningService,
      context
    )

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
