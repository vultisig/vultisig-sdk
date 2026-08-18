import { create, toBinary } from '@bufbuild/protobuf'
import { LibType } from '@vultisig/core-mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { VaultContainerSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_container_pb'
import { Vault_KeyShareSchema, VaultSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@vultisig/core-mpc/vault/utils/vaultContainerFromString'
import { encryptWithAesGcm } from '@vultisig/lib-utils/encryption/aesGcm/encryptWithAesGcm'
import { decryptVaultBackupWithPassword } from '@vultisig/lib-utils/encryption/vaultBackup/decryptVaultBackupWithPassword'
import { encryptVaultBackupWithPassword } from '@vultisig/lib-utils/encryption/vaultBackup/encryptVaultBackupWithPassword'
import {
  DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
  VAULT_BACKUP_BLOB_MAGIC,
  VAULT_BACKUP_MAGIC_LEN,
} from '@vultisig/lib-utils/encryption/vaultBackup/vaultBackupConstants'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSdkContext } from '../../../src/context/SdkContextBuilder'
import { configureWasm } from '../../../src/context/wasmRuntime'
import type { SdkEvents } from '../../../src/events/types'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import { VaultManager } from '../../../src/VaultManager'
import { Vultisig } from '../../../src/Vultisig'

const SYNTH_ECDSA_PK = '021111111111111111111111111111111111111111111111111111111111111111'
const SYNTH_EDDSA_PK = '2222222222222222222222222222222222222222222222222222222222222222'

const buildMinimalSecureVaultBinary = (): Uint8Array =>
  toBinary(
    VaultSchema,
    create(VaultSchema, {
      name: 'LegacyImportFixture',
      publicKeyEcdsa: SYNTH_ECDSA_PK,
      publicKeyEddsa: SYNTH_EDDSA_PK,
      signers: ['SyntheticDevice'],
      hexChainCode: '00'.repeat(32),
      localPartyId: 'SyntheticDevice',
      libType: LibType.DKLS,
      keyShares: [
        create(Vault_KeyShareSchema, {
          publicKey: SYNTH_ECDSA_PK,
          keyshare: 'synthetic-ecdsa-share',
        }),
        create(Vault_KeyShareSchema, {
          publicKey: SYNTH_EDDSA_PK,
          keyshare: 'synthetic-eddsa-share',
        }),
      ],
    })
  )

const wrapEncryptedVault = (encryptedVault: Buffer, version = 7n): string => {
  const container = create(VaultContainerSchema, {
    version,
    vault: encryptedVault.toString('base64'),
    isEncrypted: true,
  })

  return Buffer.from(toBinary(VaultContainerSchema, container)).toString('base64')
}

const readEncryptedPayload = (vultContent: string): Buffer =>
  Buffer.from(vaultContainerFromString(vultContent).vault, 'base64')

describe('legacy vault backup import migration', () => {
  beforeEach(() => {
    configureWasm(async () => ({}))
  })

  it('re-encrypts legacy ciphertext before persistence and emits an actionable security notice', async () => {
    const password = 'legacy-password-that-must-be-rotated'
    const innerVault = Buffer.from(buildMinimalSecureVaultBinary())
    const legacyPayload = encryptWithAesGcm({
      key: password,
      value: innerVault,
    })
    const legacyVultContent = wrapEncryptedVault(legacyPayload)
    const storage = new MemoryStorage()
    const sdk = new Vultisig({ storage })
    const notice = vi.fn<(event: SdkEvents['legacyVaultBackupMigrated']) => void>()
    sdk.on('legacyVaultBackupMigrated', notice)

    await sdk.initialize()
    const vault = await sdk.importVault(legacyVultContent, password)

    const persistedContent = vault.data.vultFileContent
    const persistedContainer = vaultContainerFromString(persistedContent)
    const persistedPayload = Buffer.from(persistedContainer.vault, 'base64')

    expect(persistedContent).not.toBe(legacyVultContent)
    expect(persistedContainer.version).toBe(7n)
    expect(persistedPayload.subarray(0, VAULT_BACKUP_MAGIC_LEN).equals(VAULT_BACKUP_BLOB_MAGIC)).toBe(true)
    expect(decryptVaultBackupWithPassword(password, persistedPayload).equals(innerVault)).toBe(true)
    expect(readEncryptedPayload(legacyVultContent).equals(legacyPayload)).toBe(true)
    await expect(storage.get(`vault:${SYNTH_ECDSA_PK}`)).resolves.toMatchObject({
      vultFileContent: persistedContent,
    })

    expect(notice).toHaveBeenCalledOnce()
    expect(notice).toHaveBeenCalledWith({
      vaultId: SYNTH_ECDSA_PK,
      vaultName: 'LegacyImportFixture',
      sourceFormat: 'legacy-sha256',
      storedFormat: 'pbkdf2-hmac-sha256',
      pbkdf2Iterations: DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
      passwordRotationRecommended: true,
      replaceLegacyBackupsRecommended: true,
      message: expect.stringMatching(/new password.*replace all legacy copies.*delete the old files/i),
    })
  }, 120_000)

  it('preserves current PBKDF2 backups byte-for-byte and does not emit a legacy warning', async () => {
    const password = 'already-current-password'
    const innerVault = Buffer.from(buildMinimalSecureVaultBinary())
    const currentVultContent = wrapEncryptedVault(encryptVaultBackupWithPassword(password, innerVault))
    const sdk = new Vultisig({ storage: new MemoryStorage() })
    const notice = vi.fn<(event: SdkEvents['legacyVaultBackupMigrated']) => void>()
    sdk.on('legacyVaultBackupMigrated', notice)

    await sdk.initialize()
    const vault = await sdk.importVault(currentVultContent, password)

    expect(vault.data.vultFileContent).toBe(currentVultContent)
    expect(notice).not.toHaveBeenCalled()
  }, 120_000)

  it('does not persist or warn when legacy decryption fails', async () => {
    const innerVault = Buffer.from(buildMinimalSecureVaultBinary())
    const legacyVultContent = wrapEncryptedVault(encryptWithAesGcm({ key: 'correct-password', value: innerVault }))
    const storage = new MemoryStorage()
    const sdk = new Vultisig({ storage })
    const notice = vi.fn<(event: SdkEvents['legacyVaultBackupMigrated']) => void>()
    sdk.on('legacyVaultBackupMigrated', notice)

    await sdk.initialize()

    await expect(sdk.importVault(legacyVultContent, 'wrong-password')).rejects.toMatchObject({
      code: 'INVALID_PASSWORD',
    })
    expect(await storage.list()).not.toContain(`vault:${SYNTH_ECDSA_PK}`)
    expect(notice).not.toHaveBeenCalled()
  })

  it('warns direct VaultManager callers after the migrated vault is durably saved', async () => {
    const password = 'direct-manager-legacy-password'
    const innerVault = Buffer.from(buildMinimalSecureVaultBinary())
    const legacyVultContent = wrapEncryptedVault(encryptWithAesGcm({ key: password, value: innerVault }))
    const storage = new MemoryStorage()
    const manager = new VaultManager(createSdkContext({ storage }))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const vault = await manager.importVault(legacyVultContent, password)

    await expect(storage.get(`vault:${SYNTH_ECDSA_PK}`)).resolves.toMatchObject({
      vultFileContent: vault.data.vultFileContent,
    })
    expect(warning).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/new password.*replace all legacy copies/i))

    warning.mockRestore()
  }, 120_000)

  it('emits the migration notice after save even when setting the active vault fails', async () => {
    const password = 'active-pointer-failure-password'
    const innerVault = Buffer.from(buildMinimalSecureVaultBinary())
    const legacyVultContent = wrapEncryptedVault(encryptWithAesGcm({ key: password, value: innerVault }))
    const storage = new MemoryStorage()
    const originalSet = storage.set.bind(storage)
    vi.spyOn(storage, 'set').mockImplementation(async (key, value) => {
      if (key === 'activeVaultId') throw new Error('synthetic active pointer failure')
      await originalSet(key, value)
    })
    const sdk = new Vultisig({ storage })
    const notice = vi.fn<(event: SdkEvents['legacyVaultBackupMigrated']) => void>()
    sdk.on('legacyVaultBackupMigrated', notice)

    await sdk.initialize()
    await expect(sdk.importVault(legacyVultContent, password)).rejects.toMatchObject({
      code: 'CORRUPTED_DATA',
    })

    expect(await storage.get(`vault:${SYNTH_ECDSA_PK}`)).not.toBeNull()
    expect(notice).toHaveBeenCalledOnce()
  }, 120_000)
})
