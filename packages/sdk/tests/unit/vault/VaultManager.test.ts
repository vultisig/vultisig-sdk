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

import { create, toBinary } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { LibType } from '@vultisig/core-mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { VaultContainerSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_container_pb'
import { Vault_KeyShareSchema, VaultSchema } from '@vultisig/core-mpc/types/vultisig/vault/v1/vault_pb'
import { encryptWithAesGcm } from '@vultisig/lib-utils/encryption/aesGcm/encryptWithAesGcm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSdkContext } from '../../../src/context/SdkContextBuilder'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import { VaultImportErrorCode } from '../../../src/vault/VaultError'
import { VaultManager } from '../../../src/VaultManager'

/**
 * Synthetic public keys and keyshares only — no real key material.
 * Used to build a minimal Vault protobuf that passes fromCommVault().
 */
const SYNTH_ECDSA_PK = '021111111111111111111111111111111111111111111111111111111111111111'
const SYNTH_EDDSA_PK = '2222222222222222222222222222222222222222222222222222222222222222'

function buildMinimalSecureVaultBinary(): Uint8Array {
  return toBinary(
    VaultSchema,
    create(VaultSchema, {
      name: 'SyntheticImportVault',
      publicKeyEcdsa: SYNTH_ECDSA_PK,
      publicKeyEddsa: SYNTH_EDDSA_PK,
      signers: ['SyntheticDevice'],
      hexChainCode: '00'.repeat(32),
      localPartyId: 'SyntheticDevice',
      resharePrefix: '',
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

  describe('getAllVaults', () => {
    it('should return empty array when no vaults exist', async () => {
      const vaults = await vaultManager.getAllVaults()
      expect(vaults).toEqual([])
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
