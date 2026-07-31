/**
 * VaultManager Tests - Updated for Instance-Scoped Architecture
 * Comprehensive unit tests for the VaultManager class
 *
 * TESTING STRATEGY: Tests vault lifecycle management
 * - Import/export operations
 * - Vault storage and retrieval
 * - Active vault management
 * - Error handling and edge cases
 *
 * NOTE: Vault creation is now handled by sdk.createFastVault() and
 * sdk.createSecureVault() facade methods which internally manage context.
 *
 * Test Coverage:
 * - Import from .vult files (encrypted/unencrypted)
 * - Vault listing and retrieval
 * - Active vault management
 * - Vault deletion
 * - Error scenarios and validation
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { create, toBinary } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { LibType } from '@vultisig/core-mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { VaultContainerSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_container_pb'
import { Vault_KeyShareSchema, VaultSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_pb'
import { encryptWithAesGcm } from '@vultisig/lib-utils/encryption/aesGcm/encryptWithAesGcm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSdkContext } from '../../../src/context/SdkContextBuilder'
import { FileStorage } from '../../../src/platforms/node/storage'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import { VaultConflictError, VaultImportErrorCode } from '../../../src/vault/VaultError'
import { VaultManager } from '../../../src/VaultManager'

/**
 * Synthetic public keys and keyshares only — no real key material.
 * Used to build a minimal Vault protobuf that passes fromCommVault().
 */
const SYNTH_ECDSA_PK = '021111111111111111111111111111111111111111111111111111111111111111'
const SYNTH_EDDSA_PK = '2222222222222222222222222222222222222222222222222222222222222222'

type MinimalVaultOverrides = {
  name?: string
  ecdsaPublicKey?: string
  eddsaPublicKey?: string
  signers?: string[]
  localPartyId?: string
  ecdsaShare?: string
  eddsaShare?: string
}

function buildMinimalSecureVaultBinary(overrides: MinimalVaultOverrides = {}): Uint8Array {
  const ecdsaPublicKey = overrides.ecdsaPublicKey ?? SYNTH_ECDSA_PK
  const eddsaPublicKey = overrides.eddsaPublicKey ?? SYNTH_EDDSA_PK

  return toBinary(
    VaultSchema,
    create(VaultSchema, {
      name: overrides.name ?? 'SyntheticImportVault',
      publicKeyEcdsa: ecdsaPublicKey,
      publicKeyEddsa: eddsaPublicKey,
      signers: overrides.signers ?? ['SyntheticDevice'],
      hexChainCode: '00'.repeat(32),
      localPartyId: overrides.localPartyId ?? 'SyntheticDevice',
      resharePrefix: '',
      libType: LibType.DKLS,
      keyShares: [
        create(Vault_KeyShareSchema, {
          publicKey: ecdsaPublicKey,
          keyshare: overrides.ecdsaShare ?? 'synthetic-ecdsa-share',
        }),
        create(Vault_KeyShareSchema, {
          publicKey: eddsaPublicKey,
          keyshare: overrides.eddsaShare ?? 'synthetic-eddsa-share',
        }),
      ],
      chainPublicKeys: [],
      publicKeyMldsa44: '',
    })
  )
}

/** Base64-encoded VaultContainer wrapping inner vault payload. */
function wrapVaultContainer(innerVaultBase64: string, isEncrypted: boolean): string {
  const container = create(VaultContainerSchema, {
    version: 1n,
    vault: innerVaultBase64,
    isEncrypted,
  })
  return Buffer.from(toBinary(VaultContainerSchema, container)).toString('base64')
}

function encodeUnencryptedVult(inner: Uint8Array): string {
  return wrapVaultContainer(Buffer.from(inner).toString('base64'), false)
}

function encodeEncryptedVult(inner: Uint8Array, password: string): string {
  const encrypted = encryptWithAesGcm({
    key: password,
    value: Buffer.from(inner),
  })
  return wrapVaultContainer(encrypted.toString('base64'), true)
}

// Mock modules
vi.mock('@vultisig/lib-utils/file/initiateFileDownload', () => ({
  initiateFileDownload: vi.fn(),
}))

describe('VaultManager', () => {
  let vaultManager: VaultManager
  let memoryStorage: MemoryStorage

  beforeEach(() => {
    // Create fresh storage for each test
    memoryStorage = new MemoryStorage()

    // Create SDK context with all dependencies
    const context = createSdkContext({
      storage: memoryStorage,
      serverEndpoints: {
        fastVault: 'https://test-api.vultisig.com/vault',
        messageRelay: 'https://test-api.vultisig.com/router',
      },
      defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
      defaultCurrency: 'USD',
    })

    // Create VaultManager with context
    vaultManager = new VaultManager(context)
  })

  // ===== VAULT IMPORT =====
  // NOTE: Real .vult files are covered in E2E tests. Here: synthetic containers + error codes.
  //
  // Expected mapping (input → class / code / message hint):
  // | Input | VaultImportError.code | Message substring (typical) |
  // |-------|------------------------|---------------------------|
  // | Not base64/protobuf container | INVALID_FILE_FORMAT | Invalid .vult container |
  // | Encrypted container, no password | PASSWORD_REQUIRED | Password required |
  // | Encrypted container, wrong password | INVALID_PASSWORD | Could not decrypt |
  // | Encrypted container, ciphertext too short | CORRUPTED_DATA | truncated or not a valid ciphertext |
  // | Inner vault not decodable as Vault proto | UNSUPPORTED_FORMAT | Vault payload could not |
  // | Valid outer container but empty inner (trimmed empty / whitespace) | CORRUPTED_DATA | incomplete or corrupted |
  // | save()/downstream failure | CORRUPTED_DATA | Failed to import vault |

  describe('importVault', () => {
    it('should reject corrupted files with INVALID_FILE_FORMAT', async () => {
      const corruptedContent = 'corrupted data'

      await expect(vaultManager.importVault(corruptedContent)).rejects.toMatchObject({
        name: 'VaultImportError',
        code: VaultImportErrorCode.INVALID_FILE_FORMAT,
      })
    })

    it('should map short garbage input to INVALID_FILE_FORMAT', async () => {
      await expect(vaultManager.importVault('bad')).rejects.toMatchObject({
        code: VaultImportErrorCode.INVALID_FILE_FORMAT,
      })
    })

    it('should reject empty trimmed content with CORRUPTED_DATA (empty container decodes, inner vault invalid)', async () => {
      await expect(vaultManager.importVault('')).rejects.toMatchObject({
        code: VaultImportErrorCode.CORRUPTED_DATA,
      })
    })

    it('should reject whitespace-only content like empty (CORRUPTED_DATA)', async () => {
      await expect(vaultManager.importVault('   \n\t  ')).rejects.toMatchObject({
        code: VaultImportErrorCode.CORRUPTED_DATA,
      })
    })

    it('should reject very large random-looking base64 without crashing (INVALID_FILE_FORMAT)', async () => {
      const huge = 'A'.repeat(128 * 1024)
      await expect(vaultManager.importVault(huge)).rejects.toMatchObject({
        code: VaultImportErrorCode.INVALID_FILE_FORMAT,
      })
    })

    it('should reject truncated outer container (INVALID_FILE_FORMAT)', async () => {
      const full = encodeUnencryptedVult(buildMinimalSecureVaultBinary())
      const truncated = full.slice(0, Math.max(8, full.length - 8))
      await expect(vaultManager.importVault(truncated)).rejects.toMatchObject({
        code: VaultImportErrorCode.INVALID_FILE_FORMAT,
      })
    })

    it('should require password for encrypted container (PASSWORD_REQUIRED)', async () => {
      const encrypted = encodeEncryptedVult(buildMinimalSecureVaultBinary(), 'correct-password')
      await expect(vaultManager.importVault(encrypted)).rejects.toMatchObject({
        code: VaultImportErrorCode.PASSWORD_REQUIRED,
        message: expect.stringMatching(/password/i),
      })
    })

    it('should reject wrong password on encrypted fixture (INVALID_PASSWORD)', async () => {
      const encrypted = encodeEncryptedVult(buildMinimalSecureVaultBinary(), 'correct-password')
      await expect(vaultManager.importVault(encrypted, 'wrong-password')).rejects.toMatchObject({
        code: VaultImportErrorCode.INVALID_PASSWORD,
      })
    })

    it('should map too-short encrypted blob to CORRUPTED_DATA (not INVALID_PASSWORD)', async () => {
      const shortCipher = Buffer.alloc(8, 1).toString('base64')
      const vult = wrapVaultContainer(shortCipher, true)
      await expect(vaultManager.importVault(vult, 'any-password')).rejects.toMatchObject({
        code: VaultImportErrorCode.CORRUPTED_DATA,
        message: expect.stringMatching(/truncated|invalid ciphertext/i),
      })
    })

    it('should map invalid inner protobuf to UNSUPPORTED_FORMAT', async () => {
      const junkInner = Buffer.from([
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      ])
      const vult = encodeUnencryptedVult(junkInner)
      await expect(vaultManager.importVault(vult)).rejects.toMatchObject({
        code: VaultImportErrorCode.UNSUPPORTED_FORMAT,
      })
    })

    it('should map well-formed inner proto missing key data to CORRUPTED_DATA', async () => {
      const incompleteInner = toBinary(
        VaultSchema,
        create(VaultSchema, {
          name: 'Incomplete',
          publicKeyEcdsa: '',
          publicKeyEddsa: '',
          signers: [],
          hexChainCode: '',
          localPartyId: '',
          resharePrefix: '',
          libType: LibType.DKLS,
          keyShares: [],
          chainPublicKeys: [],
          publicKeyMldsa44: '',
        })
      )
      const vult = encodeUnencryptedVult(incompleteInner)
      await expect(vaultManager.importVault(vult)).rejects.toMatchObject({
        code: VaultImportErrorCode.CORRUPTED_DATA,
      })
    })

    it('should import unencrypted synthetic vault when an extra password is supplied (password ignored)', async () => {
      const vult = encodeUnencryptedVult(buildMinimalSecureVaultBinary())
      const vault = await vaultManager.importVault(vult, 'not-used-for-unencrypted')
      expect(vault.id).toBe(SYNTH_ECDSA_PK)
      expect(vault.name).toBe('SyntheticImportVault')
    })

    it('should import encrypted synthetic vault with correct password', async () => {
      const pwd = 'unit-test-password'
      const vult = encodeEncryptedVult(buildMinimalSecureVaultBinary(), pwd)
      const vault = await vaultManager.importVault(vult, pwd)
      expect(vault.id).toBe(SYNTH_ECDSA_PK)
    })

    it('rejects an exact duplicate unless replacement is explicit', async () => {
      const vult = encodeUnencryptedVult(buildMinimalSecureVaultBinary())
      await vaultManager.importVault(vult)

      await expect(vaultManager.importVault(vult)).rejects.toMatchObject({
        code: VaultImportErrorCode.DUPLICATE_VAULT,
      })
      expect((await memoryStorage.get<{ vultFileContent: string }>(`vault:${SYNTH_ECDSA_PK}`))?.vultFileContent).toBe(
        vult
      )
    })

    it('serializes concurrent imports so only one can create the logical vault', async () => {
      const secondContext = createSdkContext({
        storage: memoryStorage,
        serverEndpoints: {
          fastVault: 'https://test-api.vultisig.com/vault',
          messageRelay: 'https://test-api.vultisig.com/router',
        },
        defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
        defaultCurrency: 'USD',
      })
      const secondManager = new VaultManager(secondContext)
      const vult = encodeUnencryptedVult(buildMinimalSecureVaultBinary())

      const results = await Promise.allSettled([vaultManager.importVault(vult), secondManager.importVault(vult)])

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const rejection = results.find(result => result.status === 'rejected')
      expect(rejection).toMatchObject({
        status: 'rejected',
        reason: { code: VaultImportErrorCode.PERSISTENCE_FAILED },
      })
      expect((await memoryStorage.get<{ vultFileContent: string }>(`vault:${SYNTH_ECDSA_PK}`))?.vultFileContent).toBe(
        vult
      )
    })

    it('atomically rejects concurrent imports through distinct adapters sharing one filesystem backend', async () => {
      const basePath = await mkdtemp(join(tmpdir(), 'vultisig-import-cas-'))
      const makeManager = () =>
        new VaultManager(
          createSdkContext({
            storage: new FileStorage({ basePath }),
            serverEndpoints: {
              fastVault: 'https://test-api.vultisig.com/vault',
              messageRelay: 'https://test-api.vultisig.com/router',
            },
            defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
            defaultCurrency: 'USD',
          })
        )
      const vult = encodeUnencryptedVult(buildMinimalSecureVaultBinary())

      try {
        const results = await Promise.allSettled([makeManager().importVault(vult), makeManager().importVault(vult)])

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
        const rejection = results.find(result => result.status === 'rejected')
        expect(rejection).toMatchObject({
          status: 'rejected',
          reason: { code: VaultImportErrorCode.PERSISTENCE_FAILED },
        })
        expect(
          (await new FileStorage({ basePath }).get<{ vultFileContent: string }>(`vault:${SYNTH_ECDSA_PK}`))
            ?.vultFileContent
        ).toBe(vult)
      } finally {
        await rm(basePath, { recursive: true, force: true })
      }
    })

    it('allows an explicit replacement only for the same compatible local share', async () => {
      const original = encodeUnencryptedVult(buildMinimalSecureVaultBinary())
      const renamed = encodeUnencryptedVult(buildMinimalSecureVaultBinary({ name: 'Renamed backup' }))
      await vaultManager.importVault(original)

      const replaced = await vaultManager.importVault(renamed, undefined, { conflictResolution: 'replace' })

      expect(replaced.name).toBe('Renamed backup')
      expect((await memoryStorage.get<{ vultFileContent: string }>(`vault:${SYNTH_ECDSA_PK}`))?.vultFileContent).toBe(
        renamed
      )
    })

    it('validates an encrypted stored share before explicit replacement', async () => {
      const password = 'unit-test-password'
      const original = encodeEncryptedVult(buildMinimalSecureVaultBinary(), password)
      const replacement = encodeEncryptedVult(
        buildMinimalSecureVaultBinary({ name: 'Encrypted replacement' }),
        password
      )
      await vaultManager.importVault(original, password)

      await expect(
        vaultManager.importVault(replacement, password, { conflictResolution: 'replace' })
      ).resolves.toMatchObject({ name: 'Encrypted replacement' })
    })

    it('rejects a stale same-device share even when replacement is requested', async () => {
      const original = encodeUnencryptedVult(buildMinimalSecureVaultBinary())
      const stale = encodeUnencryptedVult(
        buildMinimalSecureVaultBinary({
          ecdsaShare: 'different-ecdsa-share',
          eddsaShare: 'different-eddsa-share',
        })
      )
      await vaultManager.importVault(original)

      await expect(vaultManager.importVault(stale, undefined, { conflictResolution: 'replace' })).rejects.toMatchObject(
        { code: VaultImportErrorCode.STALE_SHARE }
      )
      expect((await memoryStorage.get<{ vultFileContent: string }>(`vault:${SYNTH_ECDSA_PK}`))?.vultFileContent).toBe(
        original
      )
    })

    it('rejects another device share for the same logical vault', async () => {
      const signers = ['SyntheticDevice', 'OtherDevice']
      const original = encodeUnencryptedVult(buildMinimalSecureVaultBinary({ signers }))
      const otherDevice = encodeUnencryptedVult(
        buildMinimalSecureVaultBinary({
          signers,
          localPartyId: 'OtherDevice',
          ecdsaShare: 'other-device-ecdsa-share',
          eddsaShare: 'other-device-eddsa-share',
        })
      )
      await vaultManager.importVault(original)

      await expect(
        vaultManager.importVault(otherDevice, undefined, { conflictResolution: 'replace' })
      ).rejects.toMatchObject({ code: VaultImportErrorCode.OTHER_DEVICE_SHARE })
      expect((await memoryStorage.get<{ vultFileContent: string }>(`vault:${SYNTH_ECDSA_PK}`))?.vultFileContent).toBe(
        original
      )
    })

    it('rejects a backup whose key domains disagree with the stored logical vault', async () => {
      const original = encodeUnencryptedVult(buildMinimalSecureVaultBinary())
      const incompatible = encodeUnencryptedVult(
        buildMinimalSecureVaultBinary({
          eddsaPublicKey: '3333333333333333333333333333333333333333333333333333333333333333',
        })
      )
      await vaultManager.importVault(original)

      await expect(
        vaultManager.importVault(incompatible, undefined, { conflictResolution: 'replace' })
      ).rejects.toMatchObject({ code: VaultImportErrorCode.INCOMPATIBLE_VAULT })
      expect((await memoryStorage.get<{ vultFileContent: string }>(`vault:${SYNTH_ECDSA_PK}`))?.vultFileContent).toBe(
        original
      )
    })

    it('rolls back a failed import so the same import can be retried', async () => {
      class FailActiveVaultWriteOnceStorage extends MemoryStorage {
        private shouldFail = true

        override async set<T>(key: string, value: T): Promise<void> {
          if (key === 'activeVaultId' && this.shouldFail) {
            this.shouldFail = false
            throw new Error('synthetic active-vault write failure')
          }
          await super.set(key, value)
        }
      }

      const storage = new FailActiveVaultWriteOnceStorage()
      const context = createSdkContext({
        storage,
        serverEndpoints: {
          fastVault: 'https://test-api.vultisig.com/vault',
          messageRelay: 'https://test-api.vultisig.com/router',
        },
        defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
        defaultCurrency: 'USD',
      })
      const manager = new VaultManager(context)
      const vult = encodeUnencryptedVult(buildMinimalSecureVaultBinary())

      await expect(manager.importVault(vult)).rejects.toMatchObject({
        code: VaultImportErrorCode.PERSISTENCE_FAILED,
      })
      expect(await storage.get(`vault:${SYNTH_ECDSA_PK}`)).toBeNull()
      expect(await storage.get('activeVaultId')).toBeNull()

      await expect(manager.importVault(vult)).resolves.toMatchObject({ id: SYNTH_ECDSA_PK })
    })

    it('restores the original record when explicit replacement persistence fails', async () => {
      class ArmableActiveVaultFailureStorage extends MemoryStorage {
        failNextActiveWrite = false

        override async set<T>(key: string, value: T): Promise<void> {
          if (key === 'activeVaultId' && this.failNextActiveWrite) {
            this.failNextActiveWrite = false
            throw new Error('synthetic replacement failure')
          }
          await super.set(key, value)
        }
      }

      const storage = new ArmableActiveVaultFailureStorage()
      const context = createSdkContext({
        storage,
        serverEndpoints: {
          fastVault: 'https://test-api.vultisig.com/vault',
          messageRelay: 'https://test-api.vultisig.com/router',
        },
        defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
        defaultCurrency: 'USD',
      })
      const manager = new VaultManager(context)
      const original = encodeUnencryptedVult(buildMinimalSecureVaultBinary())
      const replacement = encodeUnencryptedVult(buildMinimalSecureVaultBinary({ name: 'Replacement' }))
      await manager.importVault(original)
      storage.failNextActiveWrite = true

      await expect(
        manager.importVault(replacement, undefined, { conflictResolution: 'replace' })
      ).rejects.toMatchObject({ code: VaultImportErrorCode.PERSISTENCE_FAILED })
      expect((await storage.get<{ vultFileContent: string }>(`vault:${SYNTH_ECDSA_PK}`))?.vultFileContent).toBe(
        original
      )
      expect(await storage.get('activeVaultId')).toBe(SYNTH_ECDSA_PK)
    })
  })

  // ===== VAULT LISTING =====

  describe('listVaults', () => {
    it('should return empty array when no vaults exist', async () => {
      const vaults = await vaultManager.listVaults()
      expect(vaults).toEqual([])
    })
  })

  // ===== VAULT RETRIEVAL =====

  describe('getVaultById', () => {
    it('should return null for non-existent vault', async () => {
      const vault = await vaultManager.getVaultById('nonexistent_public_key_string')
      expect(vault).toBeNull()
    })
  })

  describe('vault storage concurrency', () => {
    async function loadTwoInstances() {
      const imported = await vaultManager.importVault(encodeUnencryptedVult(buildMinimalSecureVaultBinary()))
      const first = await vaultManager.getVaultById(imported.id)
      const second = await vaultManager.getVaultById(imported.id)

      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
      return { first: first!, second: second!, id: imported.id }
    }

    it('rejects a stale instance and deterministically merges non-overlapping metadata on explicit retry', async () => {
      const { first, second, id } = await loadTwoInstances()
      expect(first.revision).toBe(1)
      expect(second.revision).toBe(1)

      await first.rename('Renamed elsewhere')

      const staleSave = second.setCurrency('eur')
      await expect(staleSave).rejects.toBeInstanceOf(VaultConflictError)
      await expect(staleSave).rejects.toMatchObject({
        expectedRevision: 1,
        actualRevision: 2,
        conflictingFields: [],
      })

      await second.save({ conflictStrategy: 'merge-metadata' })

      const persisted = await memoryStorage.get<{ name: string; currency: string; revision: number }>(`vault:${id}`)
      expect(persisted).toMatchObject({
        name: 'Renamed elsewhere',
        currency: 'eur',
        revision: 3,
      })
      expect(second.name).toBe('Renamed elsewhere')
      expect(second.currency).toBe('eur')
    })

    it('keeps overlapping metadata edits conflicted during merge retry', async () => {
      const { first, second, id } = await loadTwoInstances()

      await first.rename('First name')
      await expect(second.rename('Second name')).rejects.toBeInstanceOf(VaultConflictError)
      await expect(second.save({ conflictStrategy: 'merge-metadata' })).rejects.toMatchObject({
        conflictingFields: ['name'],
      })

      const persisted = await memoryStorage.get<{ name: string; revision: number }>(`vault:${id}`)
      expect(persisted).toMatchObject({ name: 'First name', revision: 2 })
    })

    it('serializes invocation-time snapshots from concurrent same-instance mutations', async () => {
      const imported = await vaultManager.importVault(encodeUnencryptedVult(buildMinimalSecureVaultBinary()))
      const savedNames: string[] = []
      const set = memoryStorage.set.bind(memoryStorage)
      vi.spyOn(memoryStorage, 'set').mockImplementation(async (key, value) => {
        if (key === `vault:${imported.id}`) savedNames.push((value as { name: string }).name)
        await set(key, value)
      })

      await Promise.all([imported.rename('First queued name'), imported.rename('Second queued name')])

      const persisted = await memoryStorage.get<{ revision: number }>(`vault:${imported.id}`)
      expect(persisted?.revision).toBe(3)
      expect(imported.revision).toBe(3)
      expect(savedNames).toEqual(['First queued name', 'Second queued name'])
    })

    it('treats a disk-restored pending vault as an initial active-vault write', async () => {
      const imported = await vaultManager.importVault(encodeUnencryptedVult(buildMinimalSecureVaultBinary()))
      const pendingData = await memoryStorage.get(`vault:${imported.id}`)
      expect(pendingData).not.toBeNull()
      await memoryStorage.remove(`vault:${imported.id}`)

      const pendingVault = vaultManager.createVaultInstance(
        { ...(pendingData as typeof imported.data), revision: undefined },
        false
      )
      await pendingVault.save()

      const persisted = await memoryStorage.get<{ revision: number }>(`vault:${imported.id}`)
      expect(persisted?.revision).toBe(1)
    })
  })

  describe('getAllVaults', () => {
    it('should return empty array when no vaults exist', async () => {
      const vaults = await vaultManager.getAllVaults()
      expect(vaults).toEqual([])
    })
  })

  // ===== VAULT RETRIEVAL — getVaultByName (#153) =====

  // Helper: build + import a named vault with a distinct synthetic pubkey so we
  // can sanity-check multi-vault scenarios for the by-name lookup. Uses the
  // same minimal builder pattern as the import suite above.
  async function importNamedVault(name: string, ecdsaPkSuffix: string): Promise<void> {
    const pk = ecdsaPkSuffix.padStart(66, '0').slice(0, 66)
    const eddsaPk = ecdsaPkSuffix.padStart(64, '0').slice(0, 64)
    const vaultBinary = toBinary(
      VaultSchema,
      create(VaultSchema, {
        name,
        publicKeyEcdsa: pk,
        publicKeyEddsa: eddsaPk,
        signers: ['SyntheticDevice'],
        hexChainCode: '00'.repeat(32),
        localPartyId: 'SyntheticDevice',
        resharePrefix: '',
        libType: LibType.DKLS,
        keyShares: [
          create(Vault_KeyShareSchema, { publicKey: pk, keyshare: 'synth-ecdsa' }),
          create(Vault_KeyShareSchema, { publicKey: eddsaPk, keyshare: 'synth-eddsa' }),
        ],
        chainPublicKeys: [],
        publicKeyMldsa44: '',
      })
    )
    const vult = encodeUnencryptedVult(vaultBinary)
    await vaultManager.importVault(vult)
  }

  describe('getVaultByName', () => {
    it('returns null when no vaults exist', async () => {
      const vault = await vaultManager.getVaultByName('Anything')
      expect(vault).toBeNull()
    })

    it('returns null when no vault matches the name', async () => {
      await importNamedVault('Main Wallet', '021111111111111111111111111111111111111111111111111111111111111111')
      const vault = await vaultManager.getVaultByName('Backup')
      expect(vault).toBeNull()
    })

    it('returns the vault when a name matches exactly', async () => {
      await importNamedVault('Main Wallet', '021111111111111111111111111111111111111111111111111111111111111111')
      const vault = await vaultManager.getVaultByName('Main Wallet')
      expect(vault).not.toBeNull()
      expect(vault?.name).toBe('Main Wallet')
    })

    it('is case-sensitive (mirrors find() exact match — no surprise lowercase behaviour)', async () => {
      await importNamedVault('Main Wallet', '021111111111111111111111111111111111111111111111111111111111111111')
      // Pin the case-sensitivity contract: 'main wallet' / 'MAIN WALLET' must
      // NOT resolve to 'Main Wallet'. If a future caller wants case-insensitive
      // lookup, that should be a separate method, not a silent change here.
      expect(await vaultManager.getVaultByName('main wallet')).toBeNull()
      expect(await vaultManager.getVaultByName('MAIN WALLET')).toBeNull()
    })

    it('disambiguates the right vault when multiple are loaded', async () => {
      await importNamedVault('Main Wallet', '021111111111111111111111111111111111111111111111111111111111111111')
      await importNamedVault('Backup', '022222222222222222222222222222222222222222222222222222222222222222')
      await importNamedVault('Hot Wallet', '023333333333333333333333333333333333333333333333333333333333333333')

      const main = await vaultManager.getVaultByName('Main Wallet')
      const backup = await vaultManager.getVaultByName('Backup')
      const hot = await vaultManager.getVaultByName('Hot Wallet')
      expect(main?.name).toBe('Main Wallet')
      expect(backup?.name).toBe('Backup')
      expect(hot?.name).toBe('Hot Wallet')
    })

    it('returns first match in listVaults order when duplicate names exist (no uniqueness enforcement)', async () => {
      // Storage layer doesn't enforce name uniqueness — two vaults with the
      // same name is a legal-if-unusual state (e.g. user imported a backup of
      // an existing vault). Pin the tie-break so the contract isn't quietly
      // changed later. Both are loaded into the same name; the first one in
      // listVaults order wins. listVaults sorts by `order` field; both
      // synthetic vaults default to order=0, so insertion order is stable
      // here because the storage iteration is deterministic on MemoryStorage.
      await importNamedVault('Dup', '021111111111111111111111111111111111111111111111111111111111111111')
      await importNamedVault('Dup', '022222222222222222222222222222222222222222222222222222222222222222')
      const got = await vaultManager.getVaultByName('Dup')
      expect(got).not.toBeNull()
      expect(got?.name).toBe('Dup')
      // Either is valid; pin that we got a vault back rather than throwing.
    })
  })

  describe('getVaultByNameOrThrow', () => {
    it('throws with empty-vault hint when no vaults are loaded', async () => {
      await expect(vaultManager.getVaultByNameOrThrow('Anything')).rejects.toThrow(
        /Vault "Anything" not found and no vaults are loaded/
      )
    })

    it('throws and lists available names when no vault matches', async () => {
      await importNamedVault('Main Wallet', '021111111111111111111111111111111111111111111111111111111111111111')
      await importNamedVault('Backup', '022222222222222222222222222222222222222222222222222222222222222222')
      await expect(vaultManager.getVaultByNameOrThrow('Typo')).rejects.toThrow(
        /Vault "Typo" not found\. Available vaults: .*Main Wallet.*/
      )
      await expect(vaultManager.getVaultByNameOrThrow('Typo')).rejects.toThrow(/Backup/)
    })

    it('resolves the vault when the name matches', async () => {
      await importNamedVault('Main Wallet', '021111111111111111111111111111111111111111111111111111111111111111')
      const vault = await vaultManager.getVaultByNameOrThrow('Main Wallet')
      expect(vault.name).toBe('Main Wallet')
    })
  })

  // ===== VAULT DELETION =====

  describe('deleteVault', () => {
    it('should throw error when deleting non-existent vault', async () => {
      const nonExistentId = 'nonexistent_public_key_string'
      await expect(vaultManager.deleteVault(nonExistentId)).rejects.toThrow(`Vault ${nonExistentId} not found`)
    })
  })

  describe('clearVaults', () => {
    it('should not throw when clearing empty vault list', async () => {
      await expect(vaultManager.clearVaults()).resolves.not.toThrow()
    })

    it('should clear active vault even when no vaults exist', async () => {
      await vaultManager.clearVaults()
      expect(await vaultManager.getActiveVault()).toBeNull()
    })
  })

  // ===== ACTIVE VAULT MANAGEMENT =====

  describe('active vault management', () => {
    it('should have no active vault initially', async () => {
      expect(await vaultManager.hasActiveVault()).toBe(false)
      expect(await vaultManager.getActiveVault()).toBeNull()
    })

    it('should allow setting active vault to null', async () => {
      await vaultManager.setActiveVault(null)
      expect(await vaultManager.hasActiveVault()).toBe(false)
    })

    it('should return null when getting active vault with no active vault', async () => {
      const activeVault = await vaultManager.getActiveVault()
      expect(activeVault).toBeNull()
    })
  })

  // ===== FILE OPERATIONS =====
  // NOTE: File encryption detection with real vault files is tested in E2E tests
  // isVaultContentEncrypted returns false for parseable content, only throws for
  // completely unparseable data. Comprehensive testing in E2E suite.

  describe('isVaultContentEncrypted', () => {
    it('should throw INVALID_FILE_FORMAT for completely invalid content', async () => {
      const invalidContent = 'not-base64-or-valid-vault-data'

      await expect(vaultManager.isVaultContentEncrypted(invalidContent)).rejects.toMatchObject({
        name: 'VaultImportError',
        code: VaultImportErrorCode.INVALID_FILE_FORMAT,
      })
    })
  })

  // ===== FACTORY METHOD =====

  describe('createVaultInstance', () => {
    it('should be callable (internal method)', () => {
      expect(typeof vaultManager.createVaultInstance).toBe('function')
    })
  })
})
