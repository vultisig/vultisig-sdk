import { fromBinary, toBinary } from '@bufbuild/protobuf'
import { hasServer } from '@vultisig/core-mpc/devices/localPartyId'
import { fromCommVault } from '@vultisig/core-mpc/types/utils/commVault'
import {
  type VaultContainer,
  VaultContainerSchema,
} from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_container_pb'
import { VaultSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@vultisig/core-mpc/vault/utils/vaultContainerFromString'
import type { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'
import { decryptVaultBackupWithPassword } from '@vultisig/lib-utils/encryption/vaultBackup/decryptVaultBackupWithPassword'
import { encryptVaultBackupWithPassword } from '@vultisig/lib-utils/encryption/vaultBackup/encryptVaultBackupWithPassword'
import {
  DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
  VAULT_BACKUP_BLOB_MAGIC,
  VAULT_BACKUP_MAGIC_LEN,
  VAULT_BACKUP_PBKDF2_HEADER_LEN,
} from '@vultisig/lib-utils/encryption/vaultBackup/vaultBackupConstants'
import { fromBase64 } from '@vultisig/lib-utils/fromBase64'

import type { SdkContext, VaultContext } from './context/SdkContext'
import type { LegacyVaultBackupMigrationNotice } from './events/types'
import { FastSigningService } from './services/FastSigningService'
import { VaultData } from './types'
import { FastVault } from './vault/FastVault'
import { SecureVault } from './vault/SecureVault'
import { VaultBase } from './vault/VaultBase'
import {
  VaultConflictError,
  VaultError,
  VaultErrorCode,
  VaultImportError,
  VaultImportErrorCode,
} from './vault/VaultError'

/** Legacy SHA-256(password)+AES-GCM: 12-byte nonce + ciphertext + 16-byte tag (minimum empty plaintext ⇒ 28 bytes). */
const MIN_LEGACY_ENCRYPTED_VAULT_LEN = 28

const GCM_AUTH_TAG_BYTES = 16

type VaultImportResult = {
  vault: VaultBase
  legacyBackupMigrated: boolean
}

type LegacyBackupMigrationHandler = (notice: LegacyVaultBackupMigrationNotice) => void

type PreparedVaultImport = {
  container: VaultContainer
  parsedVault: CoreVault
  persistedVultContent: string
  legacyBackupMigrated: boolean
  decryptedVaultBytes?: Buffer
}

const createLegacyBackupMigrationNotice = (vault: VaultBase): LegacyVaultBackupMigrationNotice => ({
  vaultId: vault.id,
  vaultName: vault.name,
  sourceFormat: 'legacy-sha256',
  storedFormat: 'pbkdf2-hmac-sha256',
  pbkdf2Iterations: DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
  passwordRotationRecommended: true,
  replaceLegacyBackupsRecommended: true,
  message:
    'This vault came from a legacy backup with a weak password KDF. The SDK upgraded its stored copy, but the password and every old backup must be treated as compromised. Export a fresh backup with a new password, replace all legacy copies, and securely delete the old files.',
})

export type VaultImportConflictResolution = 'reject' | 'replace' | 'replace-unvalidated'

export type VaultImportOptions = {
  /**
   * Existing logical vaults are rejected by default. `replace` is accepted only
   * when both backups contain the exact same share for the same local party.
   * `replace-unvalidated` also permits recovery when the stored vault cannot be
   * decoded after it has been read, and must be selected explicitly because it
   * skips those checks. Storage read failures still fail closed because there is
   * no trustworthy compare-and-set baseline for an atomic replacement.
   */
  conflictResolution?: VaultImportConflictResolution
}

const recordsEqual = <T>(left?: Partial<Record<string, T>>, right?: Partial<Record<string, T>>): boolean => {
  const normalize = (record?: Partial<Record<string, T>>) =>
    Object.entries(record ?? {}).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))

  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

const arraysEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

/**
 * VaultManager handles vault lifecycle operations
 * Manages vault storage, import/export, and active vault state
 *
 * Requires SdkContext for all dependencies (storage, config, etc.)
 */
export class VaultManager {
  private readonly context: SdkContext

  constructor(context: SdkContext) {
    this.context = context
  }

  /**
   * Get storage from context
   */
  private get storage() {
    return this.context.storage
  }

  /**
   * Initialize vault manager
   * No caching needed - storage layer handles it
   */
  async init(): Promise<void> {
    // Nothing to do! No caching.
    // Active vault ID is loaded on-demand in getActiveVault()
  }

  /**
   * Create VaultContext from SdkContext
   * Used when creating vault instances
   */
  private createVaultContext(): VaultContext {
    return {
      storage: this.context.storage,
      config: this.context.config,
      serverManager: this.context.serverManager,
      passwordCache: this.context.passwordCache,
      wasmProvider: this.context.wasmProvider,
      pushNotificationService: this.context.pushNotificationService,
    }
  }

  private repairLegacyFastVaultType(vaultData: VaultData): VaultData {
    return vaultData.type === 'secure' && hasServer(vaultData.signers) ? { ...vaultData, type: 'fast' } : vaultData
  }

  private async repairStoredLegacyFastVaultType(key: string, vaultData: VaultData): Promise<VaultData | null> {
    let current = vaultData

    for (let attempt = 0; attempt < 3; attempt++) {
      const repaired = this.repairLegacyFastVaultType(current)
      if (repaired === current) return current

      if (!this.storage.compareAndSet) {
        // Legacy adapters cannot persist the repair without risking a stale
        // snapshot overwriting a concurrent vault update. Load the canonical
        // instance now and let a later ordinary save use its revision checks.
        return repaired
      }

      const currentRevision = current.revision ?? 0
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
        throw new VaultError(VaultErrorCode.InvalidVault, `Vault ${current.id} has an invalid storage revision`)
      }
      const nextRevision = currentRevision + 1
      if (!Number.isSafeInteger(nextRevision)) {
        throw new VaultError(VaultErrorCode.InvalidVault, `Vault ${current.id} has an invalid storage revision`)
      }
      const repairedPersisted = {
        ...repaired,
        revision: nextRevision,
        lastModified: Date.now(),
      }

      if (await this.storage.compareAndSet(key, current, repairedPersisted)) return repairedPersisted

      const latest = await this.storage.get<VaultData>(key)
      if (!latest) return null
      current = latest
    }

    throw new VaultError(
      VaultErrorCode.InvalidVault,
      `Vault "${vaultData.name}" changed repeatedly while repairing its legacy fast-vault type`
    )
  }

  private decodeVaultPayload(vultContent: string, password?: string): CoreVault {
    const container = vaultContainerFromString(vultContent.trim())
    let vaultBase64 = container.vault

    if (container.isEncrypted) {
      if (!password) {
        throw new Error('Password required')
      }
      vaultBase64 = Buffer.from(decryptVaultBackupWithPassword(password, fromBase64(container.vault))).toString(
        'base64'
      )
    }

    return fromCommVault(fromBinary(VaultSchema, fromBase64(vaultBase64)))
  }

  private async decodeStoredVault(existing: VaultData, importedPassword?: string): Promise<CoreVault> {
    let container
    try {
      container = vaultContainerFromString(existing.vultFileContent.trim())
    } catch (error) {
      throw new VaultImportError(
        VaultImportErrorCode.INCOMPATIBLE_VAULT,
        'The existing local vault cannot be validated safely',
        error as Error
      )
    }

    if (!container.isEncrypted) {
      try {
        return this.decodeVaultPayload(existing.vultFileContent)
      } catch (error) {
        throw new VaultImportError(
          VaultImportErrorCode.INCOMPATIBLE_VAULT,
          'The existing local vault cannot be validated safely',
          error as Error
        )
      }
    }

    const passwordCandidates = [this.context.passwordCache.get(existing.id), importedPassword].filter(
      (candidate, index, candidates): candidate is string =>
        Boolean(candidate) && candidates.indexOf(candidate) === index
    )

    for (const candidate of passwordCandidates) {
      try {
        return this.decodeVaultPayload(existing.vultFileContent, candidate)
      } catch {
        // Try the next locally available password candidate.
      }
    }

    if (this.context.config.onPasswordRequired) {
      try {
        const requestedPassword = await this.context.config.onPasswordRequired(existing.id, existing.name)
        if (requestedPassword && !passwordCandidates.includes(requestedPassword)) {
          return this.decodeVaultPayload(existing.vultFileContent, requestedPassword)
        }
      } catch {
        // Fail closed below without replacing the local record.
      }
    }

    throw new VaultImportError(
      VaultImportErrorCode.EXISTING_VAULT_PASSWORD_REQUIRED,
      'The existing encrypted vault must be unlocked before its local share can be validated'
    )
  }

  private validateReplacement(existing: CoreVault, imported: CoreVault): void {
    if (existing.localPartyId !== imported.localPartyId) {
      throw new VaultImportError(
        VaultImportErrorCode.OTHER_DEVICE_SHARE,
        `A vault for this public key already exists for local party "${existing.localPartyId}"`
      )
    }

    const sameKeyDomains =
      existing.publicKeys.ecdsa === imported.publicKeys.ecdsa &&
      existing.publicKeys.eddsa === imported.publicKeys.eddsa &&
      existing.publicKeyMldsa === imported.publicKeyMldsa &&
      recordsEqual(existing.chainPublicKeys, imported.chainPublicKeys)

    if (!sameKeyDomains) {
      throw new VaultImportError(
        VaultImportErrorCode.INCOMPATIBLE_VAULT,
        'The imported backup does not match every public-key domain of the existing vault'
      )
    }

    const sameShareMetadata =
      arraysEqual(existing.signers, imported.signers) &&
      existing.hexChainCode === imported.hexChainCode &&
      existing.libType === imported.libType &&
      existing.resharePrefix === imported.resharePrefix &&
      existing.createdAt === imported.createdAt
    const sameShares =
      recordsEqual(existing.keyShares, imported.keyShares) &&
      recordsEqual(existing.chainKeyShares, imported.chainKeyShares) &&
      existing.keyShareMldsa === imported.keyShareMldsa

    if (!sameShareMetadata || !sameShares) {
      throw new VaultImportError(
        VaultImportErrorCode.STALE_SHARE,
        'The imported backup contains different share metadata or key material for this local party'
      )
    }
  }

  private prepareVaultImport(vultContent: string, password?: string): PreparedVaultImport {
    let decryptedVaultBytes: Buffer | undefined
    try {
      let container: VaultContainer
      try {
        container = vaultContainerFromString(vultContent.trim())
      } catch (error) {
        throw new VaultImportError(
          VaultImportErrorCode.INVALID_FILE_FORMAT,
          'Invalid .vult container: file is missing data or is not valid base64/protobuf',
          error as Error
        )
      }

      let vaultBase64: string
      let persistedVultContent = vultContent.trim()
      let legacyBackupMigrated = false
      if (container.isEncrypted) {
        if (!password) {
          throw new VaultImportError(VaultImportErrorCode.PASSWORD_REQUIRED, 'Password required for encrypted vault')
        }
        const encryptedData = fromBase64(container.vault)
        if (encryptedData.length === 0) {
          throw new VaultImportError(VaultImportErrorCode.CORRUPTED_DATA, 'Encrypted vault payload is empty')
        }

        const isPbkdf2Format =
          encryptedData.length >= VAULT_BACKUP_MAGIC_LEN &&
          encryptedData.subarray(0, VAULT_BACKUP_MAGIC_LEN).equals(VAULT_BACKUP_BLOB_MAGIC)
        const minimumLength = isPbkdf2Format
          ? VAULT_BACKUP_PBKDF2_HEADER_LEN + GCM_AUTH_TAG_BYTES
          : MIN_LEGACY_ENCRYPTED_VAULT_LEN
        if (encryptedData.length < minimumLength) {
          throw new VaultImportError(
            VaultImportErrorCode.CORRUPTED_DATA,
            'Encrypted vault payload is truncated or not a valid ciphertext'
          )
        }

        try {
          decryptedVaultBytes = decryptVaultBackupWithPassword(password, encryptedData)
          vaultBase64 = decryptedVaultBytes.toString('base64')
          legacyBackupMigrated = !isPbkdf2Format
        } catch (error) {
          throw new VaultImportError(
            VaultImportErrorCode.INVALID_PASSWORD,
            'Could not decrypt vault with the provided password',
            error as Error
          )
        }
      } else {
        vaultBase64 = container.vault
      }

      let vaultProtobuf
      try {
        vaultProtobuf = fromBinary(VaultSchema, fromBase64(vaultBase64))
      } catch (error) {
        throw new VaultImportError(
          VaultImportErrorCode.UNSUPPORTED_FORMAT,
          'Vault payload could not be decoded as a vault message',
          error as Error
        )
      }

      let parsedVault: CoreVault
      try {
        parsedVault = fromCommVault(vaultProtobuf)
      } catch (error) {
        throw new VaultImportError(
          VaultImportErrorCode.CORRUPTED_DATA,
          `Vault data appears incomplete or corrupted: ${(error as Error).message}`,
          error as Error
        )
      }

      if (legacyBackupMigrated && password && decryptedVaultBytes) {
        const migratedEncryptedData = encryptVaultBackupWithPassword(password, decryptedVaultBytes)
        container.vault = migratedEncryptedData.toString('base64')
        persistedVultContent = Buffer.from(toBinary(VaultContainerSchema, container)).toString('base64')
      }

      return {
        container,
        parsedVault,
        persistedVultContent,
        legacyBackupMigrated,
        decryptedVaultBytes,
      }
    } catch (error) {
      decryptedVaultBytes?.fill(0)
      throw error
    }
  }

  private async validateImportConflict(
    existingVault: VaultData | null,
    parsedVault: CoreVault,
    password: string | undefined,
    conflictResolution: VaultImportConflictResolution
  ): Promise<void> {
    if (!existingVault) return

    let existingCoreVault: CoreVault | null = null
    try {
      existingCoreVault = await this.decodeStoredVault(existingVault, password)
    } catch (decodeError) {
      if (conflictResolution !== 'replace-unvalidated') throw decodeError
    }

    if (!existingCoreVault) return
    this.validateReplacement(existingCoreVault, parsedVault)

    if (conflictResolution === 'reject') {
      throw new VaultImportError(
        VaultImportErrorCode.DUPLICATE_VAULT,
        'This exact local vault share already exists; pass conflictResolution: "replace" to replace it explicitly'
      )
    }
  }

  /**
   * Create Vault instance with proper service injection
   * Internal helper for consistent vault instantiation
   * Returns appropriate subclass based on vault type
   */
  createVaultInstance(vaultData: VaultData, persisted = true): VaultBase {
    // Older SDKs classified only `Server-*` signers as fast vaults. Repair
    // already-persisted legacy `VultiServer-*` records before subclass
    // dispatch so they can be loaded again. Storage-backed load paths also
    // persist the canonical type before constructing the vault.
    const repairedVaultData = this.repairLegacyFastVaultType(vaultData)

    // Fail early if vault is encrypted but no password callback provided
    if (repairedVaultData.isEncrypted && !this.context.config.onPasswordRequired) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `Vault "${repairedVaultData.name}" is password-protected but no onPasswordRequired callback was provided. ` +
          'Pass onPasswordRequired in the Vultisig constructor: ' +
          'new Vultisig({ onPasswordRequired: async () => password })'
      )
    }

    const vaultContext = this.createVaultContext()

    // Factory pattern - return appropriate subclass based on vault type
    if (repairedVaultData.type === 'fast') {
      const fastSigningService = new FastSigningService(this.context.serverManager, this.context.wasmProvider)
      return FastVault.fromStorage(repairedVaultData, fastSigningService, vaultContext, persisted)
    } else {
      return SecureVault.fromStorage(repairedVaultData, vaultContext, persisted)
    }
  }

  // ===== VAULT LIFECYCLE =====

  /**
   * Import vault from .vult file content (sets as active)
   *
   * @param vultContent - The base64-encoded .vult file content (as string)
   * @param password - Optional password for encrypted vaults
   * @returns VaultBase instance (FastVault or SecureVault depending on vault type)
   *
   * @example
   * const vultContent = fs.readFileSync('my-vault.vult', 'utf-8')
   * const vault = await vaultManager.importVault(vultContent, 'password123')
   */
  async importVault(vultContent: string, password?: string, options: VaultImportOptions = {}): Promise<VaultBase> {
    return (
      await this.importVaultWithResult(vultContent, password, options, notice => {
        console.warn(`[Vultisig SDK] ${notice.message}`)
      })
    ).vault
  }

  /**
   * Import a vault and report whether its persisted backup was upgraded from the
   * legacy SHA-256(password) format. The public SDK uses this metadata to emit a
   * user-facing security notice without changing importVault's return contract.
   *
   * @internal
   */
  async importVaultWithResult(
    vultContent: string,
    password?: string,
    options: VaultImportOptions = {},
    onLegacyBackupMigrated?: LegacyBackupMigrationHandler
  ): Promise<VaultImportResult> {
    let decryptedVaultBytes: Buffer | undefined
    try {
      const preparedImport = this.prepareVaultImport(vultContent, password)
      const { container, parsedVault, persistedVultContent, legacyBackupMigrated } = preparedImport
      decryptedVaultBytes = preparedImport.decryptedVaultBytes

      // Use ECDSA public key as vault ID
      const vaultId = parsedVault.publicKeys.ecdsa
      let existingVault: VaultData | null
      try {
        existingVault = await this.storage.get<VaultData>(`vault:${vaultId}`)
      } catch (error) {
        throw new VaultImportError(
          VaultImportErrorCode.PERSISTENCE_FAILED,
          `Failed to read the existing local vault before import: ${(error as Error).message}`,
          error as Error
        )
      }
      await this.validateImportConflict(existingVault, parsedVault, password, options.conflictResolution ?? 'reject')

      // Determine vault type from parsed vault
      const vaultType = hasServer(parsedVault.signers) ? 'fast' : 'secure'

      // Create vault context from SDK context
      const vaultContext = this.createVaultContext()

      // Create vault instance using static factory methods. Pass parsedVault to avoid parsing
      // encrypted content synchronously. When there is an existing logical vault (a validated
      // 'replace'), seed the revision baseline with its current record so vault.save() below
      // can detect - and reject - anything that changed underneath us since the read above.
      let vaultInstance: VaultBase
      if (vaultType === 'fast') {
        const fastSigningService = new FastSigningService(this.context.serverManager, this.context.wasmProvider)
        vaultInstance = FastVault.fromImport(
          vaultId,
          persistedVultContent,
          parsedVault,
          fastSigningService,
          vaultContext,
          existingVault ?? undefined
        )
      } else {
        vaultInstance = SecureVault.fromImport(
          vaultId,
          persistedVultContent,
          parsedVault,
          vaultContext,
          existingVault ?? undefined
        )
      }

      if (!this.storage.compareAndSet) {
        throw new VaultImportError(
          VaultImportErrorCode.PERSISTENCE_FAILED,
          'The configured storage adapter cannot atomically protect vault imports from concurrent overwrites'
        )
      }

      // Save to storage. vault.save() is the same revision-checked path every other vault
      // mutation uses, backed here by the adapter's atomic compare-and-set. It throws
      // VaultConflictError (caught below) instead of silently overwriting when the record
      // changes between either read and the write, and it never writes on a failed comparison.
      try {
        await vaultInstance.save()
      } catch (error) {
        if (error instanceof VaultConflictError) throw error
        throw new VaultImportError(
          VaultImportErrorCode.PERSISTENCE_FAILED,
          `Failed to persist imported vault: ${(error as Error).message}`,
          error as Error
        )
      }

      // Change password state only after the vault record commits. A pointer failure below
      // leaves the durable record in place, so the cache should already describe that record.
      if (password && container.isEncrypted) {
        this.context.passwordCache.set(vaultId, password)
      } else if (!container.isEncrypted && existingVault?.isEncrypted) {
        this.context.passwordCache.delete(vaultId)
      }

      // Notify at the durable-save boundary. This guarantees consumers learn about password
      // rotation even if setting the active-vault pointer fails after the upgraded vault has
      // already been persisted - the record is durable, the pointer is trivially recoverable,
      // so a pointer failure below must not undo this or swallow the notice for it.
      if (legacyBackupMigrated) {
        onLegacyBackupMigrated?.(createLegacyBackupMigrationNotice(vaultInstance))
      }

      // Set as active vault. The vault record already committed durably above, so a
      // failure here is a pointer-write failure, not data corruption - report it as
      // PERSISTENCE_FAILED (matching vault.save() above) rather than falling through
      // to the generic CORRUPTED_DATA catch-all below.
      try {
        await this.storage.set('activeVaultId', vaultId)
      } catch (error) {
        throw new VaultImportError(
          VaultImportErrorCode.PERSISTENCE_FAILED,
          `Failed to set imported vault as active: ${(error as Error).message}`,
          error as Error
        )
      }

      return { vault: vaultInstance, legacyBackupMigrated }
    } catch (error) {
      if (error instanceof VaultImportError) {
        throw error
      }
      if (error instanceof VaultConflictError) {
        throw new VaultImportError(
          VaultImportErrorCode.PERSISTENCE_FAILED,
          `The local vault changed during import: ${error.message}`,
          error
        )
      }
      throw new VaultImportError(
        VaultImportErrorCode.CORRUPTED_DATA,
        `Failed to import vault: ${(error as Error).message}`,
        error as Error
      )
    } finally {
      decryptedVaultBytes?.fill(0)
    }
  }

  /**
   * Export vault as .vult file content
   * @param id - Vault ID (ECDSA public key)
   * @returns Base64-encoded .vult file content
   * @throws Error if vault not found
   *
   * @example
   * const vultContent = await vaultManager.exportVault('0254b580acd52b5c...')
   * fs.writeFileSync('backup.vult', vultContent)
   */
  async exportVault(id: string): Promise<string> {
    const vaultData = await this.storage.get<VaultData>(`vault:${id}`)

    if (!vaultData) {
      throw new Error(`Vault ${id} not found`)
    }

    return vaultData.vultFileContent
  }

  /**
   * List all stored vaults as VaultBase instances
   * Users can call vault methods on each instance to get data
   *
   * @returns Array of VaultBase instances (FastVault or SecureVault)
   * @example
   * ```typescript
   * const vaults = await vaultManager.listVaults()
   * vaults.forEach(vault => {
   *   console.log(`${vault.name}: ${vault.type}`)
   * })
   * ```
   */
  async listVaults(): Promise<VaultBase[]> {
    const keys = await this.storage.list()
    const vaultKeys = keys.filter(k => {
      const parts = k.split(':')
      return parts.length === 2 && parts[0] === 'vault' // Only vault storage keys (not cache)
    })
    const vaults: VaultBase[] = []

    for (const key of vaultKeys) {
      const storedVaultData = await this.storage.get<VaultData>(key)

      if (storedVaultData) {
        try {
          const vaultData = await this.repairStoredLegacyFastVaultType(key, storedVaultData)
          if (!vaultData) continue
          vaults.push(this.createVaultInstance(vaultData))
        } catch {
          // Skip vaults that can't be instantiated (e.g., encrypted vault
          // without onPasswordRequired). They're still accessible individually
          // via getVaultById() once the callback is provided.
        }
      }
    }

    // Sort by order field
    return vaults.sort((a, b) => a.order - b.order)
  }

  /**
   * Get vault instance by ID
   *
   * @param id - Vault ID (ECDSA public key)
   * @returns VaultBase instance or null if not found
   * @example
   * ```typescript
   * const vault = await vaultManager.getVaultById('0254b580acd52b5c...')
   * if (vault) {
   *   const balance = await vault.balance('Bitcoin')
   * }
   * ```
   */
  async getVaultById(id: string): Promise<VaultBase | null> {
    const key = `vault:${id}`
    const storedVaultData = await this.storage.get<VaultData>(key)

    if (!storedVaultData) {
      return null
    }

    const vaultData = await this.repairStoredLegacyFastVaultType(key, storedVaultData)
    if (!vaultData) return null

    return this.createVaultInstance(vaultData)
  }

  /**
   * Get vault instance by display name. Case-sensitive lookup against the
   * `name` field on every stored vault. Returns `null` if no vault has a
   * matching name; if multiple vaults share the same name (the storage layer
   * doesn't enforce uniqueness), returns the FIRST match in `listVaults()`
   * order (the same `order` field listVaults sorts by).
   *
   * Convenience wrapper around `listVaults().find()` — every autoresearch
   * agent scenario that loaded a vault by name had to independently rediscover
   * that pattern (see issue #153). This method makes "find my vault by the
   * name the user typed" a single call.
   *
   * @param name - Vault display name as set at creation / shown in the UI
   * @returns VaultBase instance or null if no vault has that name
   * @example
   * ```typescript
   * const vault = await vaultManager.getVaultByName('Main Wallet')
   * if (vault) {
   *   const balance = await vault.balance('Bitcoin')
   * }
   * ```
   */
  async getVaultByName(name: string): Promise<VaultBase | null> {
    const vaults = await this.listVaults()
    return vaults.find(v => v.name === name) ?? null
  }

  /**
   * Get vault instance by display name, throwing with a helpful error that
   * lists available vault names when no match is found. Use this when a
   * missing vault is a programming error in the caller (CLI argument typo,
   * eval scenario misconfigured) rather than a user-facing fallthrough.
   *
   * @param name - Vault display name
   * @returns VaultBase instance
   * @throws Error if no vault matches, with the available vault names in the
   *   message so the caller can see what they should have asked for.
   * @example
   * ```typescript
   * try {
   *   const vault = await vaultManager.getVaultByNameOrThrow('TestVault')
   * } catch (e) {
   *   // e.message: 'Vault "TestVault" not found. Available vaults: Main Wallet, Backup'
   * }
   * ```
   */
  async getVaultByNameOrThrow(name: string): Promise<VaultBase> {
    const vault = await this.getVaultByName(name)
    if (vault) {
      return vault
    }
    const available = (await this.listVaults()).map(v => v.name).join(', ')
    const suffix = available.length > 0 ? `. Available vaults: ${available}` : ' and no vaults are loaded'
    throw new Error(`Vault "${name}" not found${suffix}`)
  }

  /**
   * Get all vault instances
   * Async equivalent to listVaults()
   *
   * @returns Array of all vault instances
   */
  async getAllVaults(): Promise<VaultBase[]> {
    return this.listVaults()
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(id: string): Promise<void> {
    // Get vault instance
    const vault = await this.getVaultById(id)

    if (!vault) {
      throw new Error(`Vault ${id} not found`)
    }

    // Let vault delete itself
    await vault.delete()

    // Clear active vault if it was the deleted one
    const activeId = await this.storage.get<string>('activeVaultId')
    if (activeId === id) {
      await this.storage.remove('activeVaultId')
    }
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    // Remove all SDK-owned per-vault and pending-vault data.
    const keys = await this.storage.list()
    const vaultKeys = keys.filter(
      key =>
        key.startsWith('vault:') ||
        key.startsWith('pending:') ||
        key.startsWith('cache:') ||
        key === 'pushNotificationRegistrations'
    )

    for (const key of vaultKeys) {
      await this.storage.remove(key)
    }

    // Clear active vault
    await this.storage.remove('activeVaultId')
  }

  // ===== ACTIVE VAULT MANAGEMENT =====

  /**
   * Switch to different vault
   */
  async setActiveVault(id: string | null): Promise<void> {
    if (id !== null) {
      await this.storage.set('activeVaultId', id)
    } else {
      await this.storage.remove('activeVaultId')
    }
  }

  /**
   * Get current active vault
   */
  async getActiveVault(): Promise<VaultBase | null> {
    const id = await this.storage.get<string>('activeVaultId')

    if (id === null || id === undefined) {
      return null
    }

    return this.getVaultById(id)
  }

  /**
   * Check if there's an active vault
   */
  async hasActiveVault(): Promise<boolean> {
    const id = await this.storage.get<string>('activeVaultId')
    return id !== null && id !== undefined
  }

  // ===== UTILITY METHODS =====

  /**
   * Check if .vult file content is encrypted
   * @param vultContent - The .vult file content as a string
   * @returns true if encrypted, false otherwise
   */
  async isVaultContentEncrypted(vultContent: string): Promise<boolean> {
    try {
      const container = vaultContainerFromString(vultContent.trim())
      return container.isEncrypted
    } catch (error) {
      throw new VaultImportError(
        VaultImportErrorCode.INVALID_FILE_FORMAT,
        `Failed to parse vault container: ${(error as Error).message}`,
        error as Error
      )
    }
  }
}
