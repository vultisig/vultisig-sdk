import { fromBinary } from '@bufbuild/protobuf'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'

import type {
  Signature,
  SigningMode,
  SigningPayload,
  VaultCreationStep,
  VaultData,
} from '../types'
import { VaultBase } from './VaultBase'
import { VaultError, VaultErrorCode } from './VaultError'
import type { VaultConfig } from './VaultServices'

/**
 * SecureVault - Multi-device MPC vault
 *
 * Secure vaults use multi-device threshold signature scheme with (n+1)/2 threshold.
 * They can be encrypted or unencrypted and support relay/local signing modes.
 *
 * Key characteristics:
 * - Can be encrypted or unencrypted (isEncrypted varies)
 * - (n+1)/2 threshold for n signers
 * - Supports 'relay' and/or 'local' signing modes (when implemented)
 * - Does NOT support 'fast' signing mode
 */
export class SecureVault extends VaultBase {
  constructor(
    vaultId: number,
    name: string,
    vultFileContent: string,
    config?: VaultConfig,
    parsedVaultData?: CoreVault
  ) {
    super(vaultId, name, vultFileContent, config, parsedVaultData)
  }

  /**
   * Secure vaults support relay and/or local signing modes
   * Not yet implemented - returns empty array
   */
  get availableSigningModes(): SigningMode[] {
    return []
  }

  /**
   * Secure vaults use (n+1)/2 threshold for n signers
   * Example: 3 signers → threshold of 2
   */
  get threshold(): number {
    return Math.floor((this.coreVault.signers.length + 1) / 2)
  }

  /**
   * Sign a transaction using relay or local signing mode
   *
   * @param mode - Signing mode ('relay' or 'local')
   * @param payload - Transaction payload to sign
   * @returns Signature from multi-device coordination
   */
  async sign(_payload: SigningPayload): Promise<Signature> {
    // Ensure keyShares are loaded (will decrypt if encrypted)
    await this.ensureKeySharesLoaded()
    throw new VaultError(VaultErrorCode.NotImplemented, 'not implemented')
    // Sign using appropriate service
    // let signature: Signature = ''

    // if (mode === 'relay') {
    //   if (!this.relaySigningService) {
    //     throw new VaultError(
    //       VaultErrorCode.NotImplemented,
    //       'Relay signing not implemented yet. ' +
    //         'This feature is planned for future releases.'
    //     )
    //   }
    //   // When implemented:
    //   // signature = await this.relaySigningService.sign(
    //   //   this.coreVault,
    //   //   payload,
    //   //   step => this.emit('signingProgress', { step })
    //   // )
    //   throw new VaultError(
    //     VaultErrorCode.NotImplemented,
    //     'Relay signing not implemented yet'
    //   )
    // } else if (mode === 'local') {
    //   if (!this.localSigningService) {
    //     throw new VaultError(
    //       VaultErrorCode.NotImplemented,
    //       'Local signing not implemented yet. ' +
    //         'This feature is planned for future releases.'
    //     )
    //   }
    //   // When implemented:
    //   // signature = await this.localSigningService.sign(
    //   //   this.coreVault,
    //   //   payload,
    //   //   step => this.emit('signingProgress', { step })
    //   // )
    //   throw new VaultError(
    //     VaultErrorCode.NotImplemented,
    //     'Local signing not implemented yet'
    //   )
    // } else {
    //   throw new VaultError(
    //     VaultErrorCode.InvalidConfig,
    //     `Unsupported signing mode: ${mode}. ` +
    //       `Available modes: ${this.availableSigningModes.join(', ')}`
    //   )
    // }

    // When signing is implemented, emit events:
    // this.emit('transactionSigned', { signature, payload })
    // return signature
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
   * @param options - Vault creation options
   * @throws Not yet implemented
   * @todo Implement secure vault creation
   */
  static async create(options: {
    name: string
    password: string
    devices: number
    threshold?: number
    onProgress?: (step: VaultCreationStep) => void
  }): Promise<{
    vault: SecureVault
    vaultId: string
    sessionId: string
  }> {
    // Suppress unused parameter warnings
    void options

    throw new VaultError(
      VaultErrorCode.NotImplemented,
      'SecureVault.create() is not yet implemented. Use relay server for multi-device setup.'
    )
  }

  /**
   * Reconstruct a SecureVault instance from stored VaultData
   */
  static fromStorage(vaultData: VaultData, config?: VaultConfig): SecureVault {
    // Validate vault type
    if (vaultData.type !== 'secure') {
      throw new VaultError(
        VaultErrorCode.InvalidVault,
        `Cannot create SecureVault from ${vaultData.type} vault data`
      )
    }

    // Use the constructor with stored vult file content
    const vault = new SecureVault(
      vaultData.id,
      vaultData.name,
      vaultData.vultFileContent || '',
      config
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
