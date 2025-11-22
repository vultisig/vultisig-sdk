import { fromBinary } from '@bufbuild/protobuf'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'

import type { Storage } from '../runtime/storage/types'
import { FastSigningService } from '../services/FastSigningService'
import type {
  Signature,
  SigningMode,
  SigningPayload,
  VaultData,
} from '../types'
import { VaultBase } from './VaultBase'
import { VaultError, VaultErrorCode } from './VaultError'
import type { VaultConfig, VaultServices } from './VaultServices'

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

  constructor(
    vaultId: number,
    name: string,
    vultFileContent: string,
    services: VaultServices,
    config?: VaultConfig,
    storage?: Storage,
    parsedVaultData?: CoreVault
  ) {
    super(
      vaultId,
      name,
      vultFileContent,
      services,
      config,
      storage,
      parsedVaultData
    )

    // Fast vaults REQUIRE FastSigningService
    if (!services.fastSigningService) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        'FastSigningService required for fast vaults. ' +
          'Fast vaults use 2-of-2 MPC signing with VultiServer.'
      )
    }

    this.fastSigningService = services.fastSigningService
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
      const signature = await this.fastSigningService.signWithServer(
        this.coreVault,
        payload,
        password,
        step => {
          // Emit progress on THIS vault instance
          this.emit('signingProgress', { step })
        }
      )

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
    if (
      !this.vaultData.vultFileContent ||
      this.vaultData.vultFileContent.trim().length === 0
    ) {
      throw new VaultError(
        VaultErrorCode.InvalidVault,
        'Vault file content is empty. Cannot load keyShares.'
      )
    }

    // Parse vault file to get keyShares
    const container = vaultContainerFromString(
      this.vaultData.vultFileContent.trim()
    )

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
    this.emit('vault:unlocked', { vaultId: this.id })
  }

  /**
   * Reconstruct a FastVault instance from stored VaultData
   */
  static fromStorage(
    vaultData: VaultData,
    services: VaultServices,
    config?: VaultConfig,
    storage?: Storage
  ): FastVault {
    // Validate vault type
    if (vaultData.type !== 'fast') {
      throw new VaultError(
        VaultErrorCode.InvalidVault,
        `Cannot create FastVault from ${vaultData.type} vault data`
      )
    }

    // Use the constructor with stored vult file content
    const vault = new FastVault(
      vaultData.id,
      vaultData.name,
      vaultData.vultFileContent || '',
      services,
      config,
      storage
    )

    // Override constructor defaults with stored preferences from VaultData
    if (vaultData.chains && vaultData.chains.length > 0) {
      ;(vault as any)._userChains = vaultData.chains.map(
        (c: string) => c as any
      )
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
